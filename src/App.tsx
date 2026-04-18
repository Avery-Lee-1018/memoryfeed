import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import CardSkeleton from "@/components/CardSkeleton";
import MemoShapes from "@/components/MemoShapes";
import MySourcesView from "@/components/MySourcesView";
import AppToast, { type AppToastState } from "@/components/AppToast";
import AuthGate from "@/components/AuthGate";
import SplashScreen from "@/components/SplashScreen";
import { authorizedFetch, readJson } from "@/lib/api";
import { FEED_START_DATE, getTitleForDate, shiftDate, toIsoDate } from "@/lib/feed";
import {
  type SourceBulkResult,
  buildSourceResultToast,
  normalizeSourceEntry,
  parseSourceInput,
} from "@/lib/sources";
import type { SourceEntry } from "@/types/source";
import { fetchMe, logout, type AuthUser } from "@/lib/auth-session";

const SKELETON_MIN_MS = 500;

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
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
  const [toast, setToast] = useState<AppToastState>(null);

  useEffect(() => {
    fetchMe()
      .then((user) => setAuthUser(user))
      .finally(() => setAuthReady(true));
  }, []);

  const loadFeed = async (date: string) => {
    setLoading(true);
    return authorizedFetch(`/api/feed/today?date=${date}`)
      .then(async (r) => {
        if (r.status === 401) {
          setAuthUser(null);
          throw new Error("AUTH_REQUIRED");
        }
        return r;
      })
      .then((r) => readJson<{ items: FeedItem[] }>(r))
      .then((data) => {
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setInitialItemCount(nextItems.length);
        setReplacingIds(new Set());
        setMemoItemIds(new Set(nextItems.filter((i) => i.hasNote).map((i) => i.id)));
      })
      .catch((error) => {
        if (error instanceof Error && error.message === "AUTH_REQUIRED") return;
        console.error(error);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!authUser) return;
    void loadFeed(selectedDate);
  }, [selectedDate, authUser]);

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
    if (!authUser) return;
    if (view === "sources") {
      void loadSources(true);
    }
  }, [view, authUser]);

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
      setToast(buildSourceResultToast(data));
      if ((data.added ?? 0) > 0 || (data.duplicateCount ?? 0) > 0) {
        void loadSources(false);
        void loadFeed(selectedDate);
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
    !authReady ? (
      <SplashScreen />
    ) : !authUser ? (
      <AuthGate onSignedIn={(user) => { setAuthUser(user); setAuthReady(true); }} />
    ) : (
    <div className="relative isolate min-h-dvh overflow-x-clip bg-background">
      <MemoShapes show={view === "feed" && hasMemoToday} dateKey={selectedDate} />
      <div className="relative z-20 mx-auto flex min-h-dvh w-full max-w-[1160px] flex-col px-3 py-4 md:px-4 md:py-6">
        <div className="mb-12 pt-2 sm:mb-14 sm:pt-4">
          <div className="flex items-end justify-between gap-5 sm:gap-5">
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
            <button
              onClick={async () => {
                await logout();
                setAuthUser(null);
                setItems([]);
                setSources([]);
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              로그아웃
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
      <AppToast
        toast={toast}
        sourceSubmitting={sourceSubmitting}
        onClose={() => setToast(null)}
        onUndo={() => toast?.undoFn?.()}
        onRetry={retryFailedSources}
      />
    </div>
    )
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
