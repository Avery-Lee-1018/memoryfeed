import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import CardSkeleton from "@/components/CardSkeleton";
import MemoShapes from "@/components/MemoShapes";
import MySourcesView, { SourceEntry } from "@/components/MySourcesView";
import { authorizedFetch, readJson } from "@/lib/api";

const SKELETON_MIN_MS = 500;
const FEED_START_DATE = "2026-04-01";

const TITLE_CANDIDATES = [
  "수면 위로 떠오른 것들",
  "오늘은 이 셋이면 충분하다",
  "다시 보게 된 이유가 있다면",
  "그냥 지나치긴 아쉬운 것들",
  "익숙한데 낯선 단서들",
  "오늘따라 오래 남는 문장들",
  "말없이 붙잡히는 장면들",
  "조용히 다시 열어본 것들",
  "지금의 마음에 닿는 기록",
  "잠깐 멈추게 되는 이유",
  "한 번 더 읽게 된 조각들",
  "어제와는 다른 결의 문장",
  "지나쳤다가 돌아온 생각",
  "오늘의 속도를 바꾸는 힌트",
  "문득 다시 붙는 연결들",
  "가볍게 넘기기 어려운 것",
  "지금 필요한 온도의 문장",
  "늦게 도착한 좋은 단서",
  "한 칸 더 깊어지는 시선",
  "의외로 오래 머무는 장면",
  "잊힌 줄 알았던 감각들",
  "다시 보면 달라지는 조각",
  "오늘의 맥락을 깨우는 것",
  "잠깐의 정적을 만드는 글",
  "익숙함 바깥의 작은 힌트",
  "지금 꺼내기 좋은 기억",
  "어쩐지 오늘 맞는 흐름",
  "생각보다 가까이 있던 단서",
  "한 번쯤 멈춰 볼 이유",
  "계속 남아 있던 여운",
];

const toIsoDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const shiftDate = (isoDate: string, deltaDays: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return toIsoDate(d);
};

const getTitleForDate = (isoDate: string) => {
  // Use a coprime step to cycle through all titles before repeating.
  // This guarantees day-to-day variation and avoids clustered repeats.
  const serialDay = Math.floor(new Date(`${isoDate}T00:00:00`).getTime() / 86400000);
  const len = TITLE_CANDIDATES.length;
  const step = 7; // gcd(7, 30) = 1
  const offset = 11;
  const idx = ((serialDay * step + offset) % len + len) % len;
  return TITLE_CANDIDATES[idx];
};

function parseSourceInput(input: string) {
  const tokens = input
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);

  const deduped = new Set<string>();
  for (const token of tokens) {
    try {
      const parsed = new URL(token);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      parsed.hash = "";
      deduped.add(parsed.toString());
    } catch {
      // ignore invalid URL token
    }
  }

  return {
    totalTokens: tokens.length,
    urls: [...deduped],
  };
}

function normalizeSourceEntry(raw: Record<string, unknown>): SourceEntry {
  const levelRaw = typeof raw.level === "string" ? raw.level : null;
  const level = levelRaw === "core" || levelRaw === "focus" || levelRaw === "light"
    ? levelRaw
    : undefined;
  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? ""),
    url: String(raw.url ?? ""),
    type: (raw.type === "rss" ? "rss" : "blog"),
    level,
    is_active: Number(raw.is_active ?? 0),
    exposureCount: Number(raw.exposureCount ?? 0),
    memoCount: Number(raw.memoCount ?? 0),
    lastExposedAt: typeof raw.lastExposedAt === "string" ? raw.lastExposedAt : null,
    lastActivityAt: typeof raw.lastActivityAt === "string" ? raw.lastActivityAt : null,
  };
}

type SourceBulkResult = {
  added?: number;
  failed?: number;
  invalidCount?: number;
  duplicateCount?: number;
  addedUrls?: string[];
  duplicateUrls?: string[];
  failedUrls?: string[];
  invalidTokens?: string[];
  error?: string;
};

type ToastState = {
  tone: "success" | "warning" | "error";
  title: string;
  description?: string;
  retryUrls?: string[];
  undoFn?: () => void;
} | null;

export default function App() {
  const [view, setView] = useState<"feed" | "sources">("feed");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [initialItemCount, setInitialItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [replacingIds, setReplacingIds] = useState<Set<number>>(new Set());
  const [memoItemIds, setMemoItemIds] = useState<Set<number>>(new Set());
  const [selectedDate, setSelectedDate] = useState(() => {
    // Restore last-viewed date within the same browser session (survives refresh).
    // sessionStorage is cleared when the tab/window is closed, so a new session
    // always starts on today.
    const stored = sessionStorage.getItem("selectedDate");
    const todayStr = toIsoDate(new Date());
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) && stored <= todayStr && stored >= FEED_START_DATE) {
      return stored;
    }
    return todayStr;
  });
  const [sourceInput, setSourceInput] = useState("");
  const [sourceSubmitting, setSourceSubmitting] = useState(false);
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/feed/today?date=${selectedDate}`)
      .then((r) => r.json() as Promise<{ items: FeedItem[] }>)
      .then((data) => {
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setInitialItemCount(nextItems.length);
        setReplacingIds(new Set());
        setMemoItemIds(new Set(nextItems.filter((i) => i.hasNote).map((i) => i.id)));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const loadSources = async (showLoading = true) => {
    if (showLoading) setSourcesLoading(true);
    try {
      const res = await authorizedFetch("/api/sources");
      const data = await readJson<{ sources?: Record<string, unknown>[] }>(res);
      const next = (data.sources ?? []).map(normalizeSourceEntry);
      setSources(next);
    } catch (error) {
      console.error(error);
    } finally {
      if (showLoading) setSourcesLoading(false);
    }
  };

  useEffect(() => {
    if (view === "sources") {
      void loadSources(true);
    }
  }, [view]);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.undoFn ? 1500 : toast.retryUrls?.length ? 8000 : 4500;
    const timeout = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const skip = async (id: number) => {
    if (selectedDate !== toIsoDate(new Date())) return;
    const currentItemIds = items.map((item) => item.id);
    const startedAt = Date.now();
    setReplacingIds((prev) => new Set(prev).add(id));

    await authorizedFetch("/api/reaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: id, type: "skip" }),
    });

    const res = await authorizedFetch("/api/feed/replacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ excludeItemIds: currentItemIds, date: selectedDate, replaceItemId: id }),
    });
    const data = (await res.json()) as { item?: FeedItem | null };

    const elapsed = Date.now() - startedAt;
    if (elapsed < SKELETON_MIN_MS) {
      await new Promise((r) => setTimeout(r, SKELETON_MIN_MS - elapsed));
    }

    setReplacingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setItems((prev) => {
      const targetIndex = prev.findIndex((item) => item.id === id);
      if (targetIndex === -1) return prev;
      if (!data.item) return prev; // no replacement available — keep current items
      const next = [...prev];
      next[targetIndex] = data.item;
      return next;
    });
  };

  const todayIso = toIsoDate(new Date());
  const isToday = selectedDate === todayIso;
  const isAtStartDate = selectedDate <= FEED_START_DATE;
  const displayedDate = new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const heroTitle = useMemo(() => getTitleForDate(selectedDate), [selectedDate]);
  const cardEnterY = 20;
  const cardExitY = -20;

  const moveDate = (delta: number) => {
    if (delta < 0 && isAtStartDate) return;
    setSelectedDate((prev) => {
      const next = shiftDate(prev, delta);
      sessionStorage.setItem("selectedDate", next);
      return next;
    });
  };

  const moveToToday = () => {
    if (isToday) return;
    sessionStorage.setItem("selectedDate", todayIso);
    setSelectedDate(todayIso);
  };

  const moveItemToLeft = (itemId: number) => {
    setItems((prev) => {
      const idx = prev.findIndex((item) => item.id === itemId);
      if (idx <= 0) return prev;
      const target = prev[idx];
      return [target, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  };

  const hasMemoToday = memoItemIds.size > 0;
  const canSubmitSource = sourceInput.trim().length > 0 && !sourceSubmitting;

  const showSourceToast = (result: SourceBulkResult) => {
    const added = result.added ?? 0;
    const duplicateCount = result.duplicateCount ?? 0;
    const invalidCount = result.invalidCount ?? 0;
    const failedUrls = result.failedUrls ?? [];
    const failedCount = invalidCount + failedUrls.length;
    const registeredCount = added + duplicateCount;
    const reasonParts: string[] = [];
    if (duplicateCount > 0) reasonParts.push(`이미 등록 ${duplicateCount}개`);
    if (invalidCount > 0) reasonParts.push(`형식 오류 ${invalidCount}개`);
    if (failedUrls.length > 0) reasonParts.push(`처리 실패 ${failedUrls.length}개`);

    if (registeredCount > 0 && failedCount === 0) {
      setToast({
        tone: "success",
        title: `${registeredCount}개 등록됨`,
        description: duplicateCount > 0 ? `새로 ${added}개, 기존 ${duplicateCount}개` : undefined,
      });
      return;
    }

    if (registeredCount === 0 && failedCount > 0) {
      setToast({
        tone: "error",
        title: `등록된 것 0개 · 안된 것 ${failedCount}개`,
        description: reasonParts.join(" · "),
        retryUrls: failedUrls.length > 0 ? failedUrls : undefined,
      });
      return;
    }

    setToast({
      tone: "warning",
      title: `등록된 것 ${registeredCount}개 · 안된 것 ${failedCount}개`,
      description: reasonParts.join(" · "),
      retryUrls: failedUrls.length > 0 ? failedUrls : undefined,
    });
  };

  const postSources = async (payload: { rawText?: string; urls?: string[] }) => {
    setSourceSubmitting(true);
    try {
      const res = await authorizedFetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const contentType = res.headers.get("content-type") || "";
      const data = (contentType.includes("application/json")
        ? await res.json()
        : { error: await res.text() }) as SourceBulkResult;
      if (!res.ok) {
        const serverMessage = (data.error ?? "").toString().slice(0, 180);
        const statusHint =
          res.status === 400
            ? "입력 형식을 확인해 주세요."
            : res.status === 500
              ? "서버 처리 중 오류가 발생했어요."
              : "요청 처리에 실패했어요.";
        setToast({
          tone: "error",
          title: `링크 추가 실패 (${res.status})`,
          description: serverMessage ? `${statusHint} ${serverMessage}` : statusHint,
        });
        return;
      }
      showSourceToast(data);
      if ((data.added ?? 0) > 0 || (data.duplicateCount ?? 0) > 0) {
        void loadSources(false);
      }
    } catch {
      const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
      setToast({
        tone: "error",
        title: "서버 연결에 실패했어요",
        description: isOffline
          ? "인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          : "로컬 개발 중이라면 `npm run dev`가 실행 중인지 확인해 주세요.",
      });
    } finally {
      setSourceSubmitting(false);
    }
  };

  const submitSources = async () => {
    const parsed = parseSourceInput(sourceInput);
    if (parsed.totalTokens === 0) {
      setToast({
        tone: "warning",
        title: "추가할 링크가 없어요",
        description: "http/https 링크를 한 줄씩 붙여넣어 주세요.",
      });
      return;
    }
    await postSources({ rawText: sourceInput });
    setSourceInput("");
  };

  const retryFailedSources = async () => {
    if (!toast?.retryUrls || toast.retryUrls.length === 0) return;
    const retryUrls = [...toast.retryUrls];
    setToast(null);
    await postSources({ urls: retryUrls });
  };

  const toggleSourceActive = async (source: SourceEntry) => {
    const nextActive = source.is_active !== 1 ? 1 : 0;
    setSources((prev) =>
      prev.map((s) => (s.id === source.id ? { ...s, is_active: nextActive } : s))
    );
    const res = await authorizedFetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: nextActive === 1 }),
    });
    if (!res.ok) {
      await loadSources(false);
      setToast({
        tone: "error",
        title: "상태 변경 실패",
        description: "잠시 후 다시 시도해 주세요.",
      });
    }
  };

  const deleteSource = (sourceId: number) => {
    const deleted = sources.find((s) => s.id === sourceId);
    if (!deleted) return;

    // Optimistic remove
    setSources((prev) => prev.filter((s) => s.id !== sourceId));

    let undone = false;
    let deleteTimer: ReturnType<typeof setTimeout>;

    const doUndo = () => {
      undone = true;
      clearTimeout(deleteTimer);
      setSources((prev) => {
        if (prev.some((s) => s.id === deleted.id)) return prev;
        return [...prev, deleted].sort((a, b) => a.id - b.id);
      });
      setToast(null);
    };

    setToast({
      tone: "error",
      title: "북마크가 떠나갔어요!",
      undoFn: doUndo,
    });

    // Actually delete after 1.5 s (matches toast auto-dismiss)
    deleteTimer = setTimeout(async () => {
      if (undone) return;
      const res = await authorizedFetch(`/api/sources/${sourceId}`, { method: "DELETE" });
      if (!res.ok) {
        setSources((prev) => {
          if (prev.some((s) => s.id === deleted.id)) return prev;
          return [...prev, deleted].sort((a, b) => a.id - b.id);
        });
        setToast({
          tone: "error",
          title: "삭제 실패",
          description: "잠시 후 다시 시도해 주세요.",
        });
      }
    }, 1500);
  };

  const moveSourceLevel = async (sourceId: number, level: "core" | "focus" | "light") => {
    setSources((prev) =>
      prev.map((source) => (source.id === sourceId ? { ...source, level } : source))
    );
    const res = await authorizedFetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level }),
    });
    if (!res.ok) {
      await loadSources(false);
      setToast({
        tone: "error",
        title: "레벨 저장 실패",
        description: "잠시 후 다시 시도해 주세요.",
      });
    }
  };

  return (
    <div className="relative isolate min-h-dvh overflow-x-clip bg-background">
      <MemoShapes show={view === "feed" && hasMemoToday} dateKey={selectedDate} />
      <div className="relative z-20 mx-auto flex min-h-dvh w-full max-w-[1160px] flex-col px-3 py-4 md:px-4 md:py-6">
        <div className="mb-12 pt-2 sm:mb-14 sm:pt-4">
          <div className="flex items-end gap-5 sm:gap-5">
            <button
              onClick={() => setView("feed")}
              className={`p-0 text-3xl font-semibold leading-none tracking-tight transition-colors sm:text-4xl ${
                view === "feed"
                  ? "text-black"
                  : "text-zinc-400 hover:text-zinc-500 hover:underline hover:underline-offset-4"
              }`}
            >
              Feed
            </button>
            <button
              onClick={() => setView("sources")}
              className={`p-0 text-3xl font-semibold leading-none tracking-tight transition-colors sm:text-4xl ${
                view === "sources"
                  ? "text-black"
                  : "text-zinc-400 hover:text-zinc-500 hover:underline hover:underline-offset-4"
              }`}
            >
              My
            </button>
          </div>
        </div>
        {view === "feed" && (
          <header className="mb-8 flex flex-col gap-3 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`title-${selectedDate}`}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  <p className="text-xs text-muted-foreground">{displayedDate}</p>
                  <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight sm:text-xl">{heroTitle}</h1>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="flex items-center gap-1 self-start pb-0.5 sm:self-auto">
              <button
                onClick={() => moveDate(-1)}
                disabled={isAtStartDate}
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-30 sm:h-7 sm:w-7 sm:text-lg"
                aria-label="이전 날짜"
              >
                <i className="ri-arrow-left-s-line" />
              </button>
              <button
                onClick={() => moveDate(1)}
                disabled={isToday}
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-30 sm:h-7 sm:w-7 sm:text-lg"
                aria-label="다음 날짜"
              >
                <i className="ri-arrow-right-s-line" />
              </button>
              <button
                onClick={moveToToday}
                disabled={isToday}
                className="ml-1 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="오늘로 이동"
              >
                TODAY
              </button>
            </div>
          </header>
        )}

        <div className={`flex-1 min-h-0 ${view === "feed" ? "min-h-[520px] sm:min-h-[560px]" : ""}`}>
          {view === "sources" ? (
            <MySourcesView
              sourceInput={sourceInput}
              sourceSubmitting={sourceSubmitting}
              sourcesLoading={sourcesLoading}
              sources={sources}
              onInputChange={setSourceInput}
              onSubmitSources={submitSources}
              onToggleActive={toggleSourceActive}
              onMoveLevel={moveSourceLevel}
              onDeleteSource={deleteSource}
            />
          ) : (
          <AnimatePresence mode="wait" initial={false}>
            {loading ? (
              <motion.div
                key={`loading-${selectedDate}`}
                initial={{ opacity: 0, y: cardEnterY }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: cardExitY }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5"
              >
                {[0, 1, 2].map((i) => (
                  <CardSkeleton key={i} />
                ))}
              </motion.div>
            ) : items.length === 0 ? (
              <motion.div
                key={`empty-${selectedDate}`}
                initial={{ opacity: 0, y: cardEnterY }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: cardExitY }}
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                <EmptyState hasItems={initialItemCount > 0} />
              </motion.div>
            ) : (
              <motion.div
                key={`cards-${selectedDate}`}
                initial={{ opacity: 0, y: cardEnterY }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: cardExitY }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5"
              >
                {items.map((item, i) => (
                  <div key={item.id} className="flex flex-col gap-2">
                    {replacingIds.has(item.id) ? (
                      <CardSkeleton />
                    ) : (
                      <FeedCard
                        {...item}
                        index={i}
                        onMemoSaved={() =>
                          {
                            setMemoItemIds((prev) => new Set(prev).add(item.id));
                            moveItemToLeft(item.id);
                          }
                        }
                        onMemoDeleted={() =>
                          setMemoItemIds((prev) => {
                            const next = new Set(prev);
                            next.delete(item.id);
                            return next;
                          })
                        }
                      />
                    )}
                    {isToday && !memoItemIds.has(item.id) && (
                      <button
                        onClick={() => skip(item.id)}
                        disabled={replacingIds.has(item.id)}
                        className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors text-center py-1 disabled:opacity-0"
                      >
                        오늘은 안볼래요
                      </button>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          )}
        </div>
      </div>
      {toast && (
        <div className="fixed left-1/2 top-12 z-50 w-[min(92vw,560px)] -translate-x-1/2">
          <div
            className={`rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${
              toast.tone === "success"
                ? "border-emerald-200 bg-emerald-50/95 text-emerald-900"
                : toast.tone === "warning"
                  ? "border-amber-200 bg-amber-50/95 text-amber-900"
                  : "border-rose-200 bg-rose-50/95 text-rose-900"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs opacity-80">{toast.description}</p>
                )}
              </div>
              {!toast.undoFn && (
                <button
                  onClick={() => setToast(null)}
                  className="mt-0.5 text-xs opacity-70 hover:opacity-100"
                  aria-label="토스트 닫기"
                >
                  닫기
                </button>
              )}
            </div>
            {toast.undoFn && (
              <div className="mt-2">
                <button
                  onClick={toast.undoFn}
                  className="rounded-full border border-current/30 bg-white/70 px-3 py-1 text-xs font-medium hover:bg-white"
                >
                  실행취소
                </button>
              </div>
            )}
            {toast.retryUrls && toast.retryUrls.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={retryFailedSources}
                  disabled={sourceSubmitting}
                  className="rounded-full border border-current/30 bg-white/70 px-3 py-1 text-xs font-medium hover:bg-white disabled:opacity-50"
                >
                  {sourceSubmitting ? "재시도 중..." : "안된 것만 등록하기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <i className="ri-inbox-line text-4xl text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {hasItems ? "해당 날짜 카드를 다 봤어요" : "해당 날짜 콘텐츠가 없어요"}
      </p>
    </div>
  );
}
