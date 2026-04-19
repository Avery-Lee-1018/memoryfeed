import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import CardSkeleton from "@/components/CardSkeleton";
import MemoShapes from "@/components/MemoShapes";
import MySourcesView from "@/components/MySourcesView";
import AppToast, { type AppToastState } from "@/components/AppToast";
import AuthGate from "@/components/AuthGate";
import SplashScreen from "@/components/SplashScreen";
import SideNav, { type CalendarDate } from "@/components/SideNav";
import AccountPanel from "@/components/AccountPanel";
import { SpiralDemo } from "@/components/ui/spiral-demo";
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
const AUTO_RELOAD_SYNC_MS = 3 * 60 * 1000;
const PENDING_UNCLASSIFIED_KEY = "memoryfeed.pendingUnclassifiedSourceIds.v1";

function extractHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<"feed" | "sources">(() => {
    const stored = sessionStorage.getItem("activeView");
    return stored === "sources" ? "sources" : "feed";
  });
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
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<AppToastState>(null);
  const [snbOpen, setSnbOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [calendarDates, setCalendarDates] = useState<CalendarDate[]>([]);
  const [isDesktopSnb, setIsDesktopSnb] = useState(false);
  const [sourceMemoFocus, setSourceMemoFocus] = useState<{ id: number; name: string } | null>(null);
  const lastMyScrollYRef = useRef(0);
  const restoreMyScrollRef = useRef(false);
  const [skipReasonItemId, setSkipReasonItemId] = useState<number | null>(null);
  const [onboardingHosts, setOnboardingHosts] = useState<string[]>([]);
  const [onboardingSourceIds, setOnboardingSourceIds] = useState<number[]>([]);
  const [pendingSourceIds, setPendingSourceIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(PENDING_UNCLASSIFIED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) ? parsed.filter((v) => Number.isFinite(v)).map(Number) : [];
    } catch {
      return [];
    }
  });
  const [showIntro, setShowIntro] = useState(false);
  const onboardingScheduledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchMe()
      .then((user) => setAuthUser(user))
      .finally(() => setAuthReady(true));
  }, []);

  // Clamp selectedDate to feedStartDate after authUser loads
  useEffect(() => {
    if (!authUser) return;
    const start = authUser.createdAt?.slice(0, 10) ?? FEED_START_DATE;
    if (selectedDate < start) {
      setSelectedDate(start);
      sessionStorage.setItem("selectedDate", start);
    }
  }, [authUser]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Reload only on visible tab to avoid surprising background refreshes.
      if (document.visibilityState === "visible") {
        window.location.reload();
      }
    }, AUTO_RELOAD_SYNC_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    sessionStorage.setItem("activeView", view);
  }, [view]);

  const handleIntroComplete = () => setShowIntro(false);

  const handleSignedIn = (user: AuthUser) => {
    setAuthUser(user);
    setAuthReady(true);
    // Show intro only for explicit sign-in events.
    // Session restore on page refresh should not trigger intro.
    setShowIntro(true);
  };

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktopSnb(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const loadFeed = async (date: string) => {
    setLoading(true);
    setMemoItemIds(new Set()); // clear immediately so stamps don't flicker on date change
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
        void loadCalendar();
      })
      .catch((error) => {
        if (error instanceof Error && error.message === "AUTH_REQUIRED") return;
        console.error(error);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!authUser) return;
    if (sourceMemoFocus) return;
    void loadFeed(selectedDate);
  }, [selectedDate, authUser, sourceMemoFocus]);

  const loadSourceMemoFeed = async (sourceId: number, sourceName: string) => {
    lastMyScrollYRef.current = window.scrollY;
    setLoading(true);
    setSourceMemoFocus({ id: sourceId, name: sourceName });
    try {
      const res = await authorizedFetch(`/api/sources/${sourceId}/memos`);
      const data = await readJson<{ items?: FeedItem[] }>(res);
      const nextItems = data.items ?? [];
      setItems(nextItems);
      setInitialItemCount(nextItems.length);
      setReplacingIds(new Set());
      setMemoItemIds(new Set(nextItems.filter((i) => i.hasNote).map((i) => i.id)));
      setView("feed");
      setSnbOpen(false);
    } catch (error) {
      console.error(error);
      setToast({
        tone: "error",
        title: "소스 피드를 불러오지 못했어요",
        description: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  };

  const backToMyFromSourceFeed = () => {
    setSourceMemoFocus(null);
    setView("sources");
    setSnbOpen(false);
    restoreMyScrollRef.current = true;
  };

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
    localStorage.setItem(PENDING_UNCLASSIFIED_KEY, JSON.stringify(pendingSourceIds));
  }, [pendingSourceIds]);

  useEffect(() => {
    if (onboardingHosts.length === 0 || sources.length === 0) return;
    const matched = onboardingHosts
      .map((host) => ({
        host,
        source: sources.find((s) => extractHost(s.url) === host),
      }))
      .filter((x): x is { host: string; source: SourceEntry } => !!x.source)
      .filter((x) => !onboardingScheduledRef.current.has(x.host));

    matched.forEach((item, idx) => {
      onboardingScheduledRef.current.add(item.host);
      window.setTimeout(() => {
        setOnboardingHosts((prev) => prev.filter((h) => h !== item.host));
        setOnboardingSourceIds((prev) => (prev.includes(item.source.id) ? prev : [...prev, item.source.id]));
        setPendingSourceIds((prev) => (prev.includes(item.source.id) ? prev : [...prev, item.source.id]));
      }, (idx + 1) * 280);
    });
  }, [onboardingHosts, sources]);

  useEffect(() => {
    if (sources.length === 0) return;
    const existing = new Set(sources.map((s) => s.id));
    setPendingSourceIds((prev) => prev.filter((id) => existing.has(id)));
    // Auto-resolve from unclassified after actual interaction starts.
    setPendingSourceIds((prev) =>
      prev.filter((id) => {
        const s = sources.find((x) => x.id === id);
        if (!s) return false;
        return s.exposureCount === 0 && s.memoCount === 0;
      })
    );
  }, [sources]);

  useEffect(() => {
    if (view !== "sources" || !restoreMyScrollRef.current) return;
    const y = lastMyScrollYRef.current;
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "auto" });
      restoreMyScrollRef.current = false;
    });
  }, [view, sourcesLoading]);

  const loadCalendar = async () => {
    try {
      const res = await authorizedFetch("/api/stats/calendar");
      const data = await readJson<{ startDate?: string; dates?: CalendarDate[] }>(res);
      if (data.dates) setCalendarDates(data.dates);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    void loadCalendar();
  }, [authUser]);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.undoFn ? 1500 : toast.retryUrls?.length ? 8000 : 4500;
    const timeout = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const skip = async (id: number, reason: "resurface_later" | "not_my_interest") => {
    if (selectedDate !== toIsoDate(new Date())) return;
    const currentItemIds = items.map((item) => item.id);
    const startedAt = Date.now();
    setReplacingIds((prev) => new Set(prev).add(id));

    await authorizedFetch("/api/reaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: id, type: "skip", reason }),
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
      if (!data.item) return prev.filter((item) => item.id !== id); // no replacement -> feed out
      const next = [...prev];
      next[targetIndex] = data.item;
      return next;
    });
  };

  const reportContent = async (id: number, payload: { issues: string[]; details?: string }) => {
    const currentItemIds = items.map((item) => item.id);
    const startedAt = Date.now();
    setReplacingIds((prev) => new Set(prev).add(id));
    const res = await authorizedFetch(`/api/items/${id}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issues: payload.issues, details: payload.details }),
    });
    const data = (await res.json()) as { repaired: boolean; item?: FeedItem | null; reason?: string };
    if (data.repaired && data.item) {
      setItems((prev) => prev.map((item) => (item.id === id ? data.item! : item)));
      const elapsed = Date.now() - startedAt;
      if (elapsed < SKELETON_MIN_MS) await new Promise((r) => setTimeout(r, SKELETON_MIN_MS - elapsed));
      setReplacingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setToast({
        tone: "success",
        title: "콘텐츠를 개선했어요",
      });
      return;
    }
    // Not repaired — fetch a replacement card
    const repRes = await authorizedFetch("/api/feed/replacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ excludeItemIds: currentItemIds, date: selectedDate, replaceItemId: id }),
    });
    const repData = (await repRes.json()) as { item?: FeedItem | null };
    if (repData.item) {
      setItems((prev) => prev.map((item) => (item.id === id ? repData.item! : item)));
    } else {
      // Guarantee deterministic outcome: if not fixable and no replacement, remove from current feed.
      setItems((prev) => prev.filter((item) => item.id !== id));
      setToast({
        tone: "warning",
        title: "문제 콘텐츠를 피드에서 제외했어요",
      });
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed < SKELETON_MIN_MS) await new Promise((r) => setTimeout(r, SKELETON_MIN_MS - elapsed));
    setReplacingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const todayIso = toIsoDate(new Date());
  const isToday = selectedDate === todayIso;
  const feedStartDate = authUser?.createdAt?.slice(0, 10) ?? FEED_START_DATE;
  const isAtStartDate = selectedDate <= feedStartDate;
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
  const snbContextVisible = view === "feed" && !sourceMemoFocus && (snbOpen || isDesktopSnb);
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
        return { ok: false as const, data };
      }
      setToast(buildSourceResultToast(data));
      if ((data.added ?? 0) > 0 || (data.duplicateCount ?? 0) > 0) {
        const hosts = [...new Set((data.addedUrls ?? []).map(extractHost).filter(Boolean))];
        if (hosts.length > 0) {
          onboardingScheduledRef.current.clear();
          setOnboardingHosts(hosts);
          setOnboardingSourceIds([]);
        }
        void loadSources(false);
        void loadFeed(selectedDate);
      }
      return { ok: true as const, data };
    } catch {
      const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
      setToast({
        tone: "error",
        title: "서버 연결에 실패했어요",
        description: isOffline
          ? "인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          : "로컬 개발 중이라면 `npm run dev`가 실행 중인지 확인해 주세요.",
      });
      return { ok: false as const };
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
    // Start onboarding interaction immediately after CTA.
    const hosts = [...new Set(parsed.urls.map(extractHost).filter(Boolean))];
    if (hosts.length > 0) {
      onboardingScheduledRef.current.clear();
      setOnboardingHosts(hosts);
    }
    const result = await postSources({ rawText: sourceInput });
    if (!result?.ok) {
      setOnboardingHosts([]);
      onboardingScheduledRef.current.clear();
    }
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
    setPendingSourceIds((prev) => prev.filter((id) => id !== sourceId));

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
    setPendingSourceIds((prev) => prev.filter((id) => id !== sourceId));
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

  const refreshSource = async (sourceId: number) => {
    if (refreshingSourceIds.has(sourceId)) return;
    setRefreshingSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      const res = await authorizedFetch(`/api/sources/${sourceId}/refresh`, { method: "POST" });
      const data = await readJson<{
        ok?: boolean;
        refreshed?: boolean;
        changed?: boolean;
        contentDelta?: number;
        reason?: string;
        cooldownSeconds?: number;
        lastRefreshedAt?: string;
      }>(res);

      if (!res.ok) {
        setToast({ tone: "error", title: "새로고침 실패", description: "잠시 후 다시 시도해 주세요." });
        return;
      }

      if (data.refreshed === false && data.reason === "cooldown") {
        const waitSeconds = Math.max(0, Number(data.cooldownSeconds ?? 0));
        setToast({
          tone: "warning",
          title: "잠시 후 다시 새로고침해 주세요",
          description: waitSeconds > 0 ? `최대 ${waitSeconds}초 간격으로 갱신돼요.` : undefined,
        });
        return;
      }

      // Crawl is running in the background — update lastRefreshedAt optimistically.
      const lastRefreshedAt =
        typeof data.lastRefreshedAt === "string" && data.lastRefreshedAt
          ? data.lastRefreshedAt
          : new Date().toISOString();
      setSources((prev) =>
        prev.map((s) => (s.id === sourceId ? { ...s, lastRefreshedAt } : s))
      );
      if (data.changed || Number(data.contentDelta ?? 0) > 0) {
        setToast({
          tone: "success",
          title: "콘텐츠 업데이트 성공!",
          description: "앞으로 더 많은 글을 볼 수 있어요.",
        });
      } else {
        setToast({
          tone: "warning",
          title: "새로 발행된 콘텐츠가 없어요.",
          description: "다음 번에 다시 시도해 주세요.",
        });
      }
      await loadSources(false);
    } catch {
      setToast({ tone: "error", title: "새로고침 실패", description: "네트워크 상태를 확인한 뒤 다시 시도해 주세요." });
    } finally {
      setRefreshingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  return (
    !authReady ? (
      <SplashScreen />
    ) : !authUser ? (
      <AuthGate onSignedIn={handleSignedIn} />
    ) : (
    <div className="relative isolate min-h-dvh overflow-x-clip bg-background">
      <MemoShapes show={view === "feed" && !sourceMemoFocus && !snbOpen && hasMemoToday} dateKey={selectedDate} />
      <div className="relative z-20 flex min-h-dvh w-full">
        {view === "feed" && !sourceMemoFocus && (
          <SideNav
            startDate={feedStartDate}
            today={todayIso}
            calendarDates={calendarDates}
            selectedDate={selectedDate}
            onSelectDate={(date) => {
              setView("feed");
              setSelectedDate(date);
              sessionStorage.setItem("selectedDate", date);
              setSnbOpen(false);
            }}
            open={snbOpen}
            onClose={() => setSnbOpen(false)}
          />
        )}
        <div className="flex min-h-dvh flex-1 flex-col min-w-0">
        <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col px-5 py-6 md:px-10 md:py-8">
        {!sourceMemoFocus && (
        <div className="mb-12 pt-2 sm:mb-14 sm:pt-4">
          <div className="flex items-end justify-between gap-5 sm:gap-5">
            <div className="flex items-end gap-5 sm:gap-5">
              <button
                onClick={() => {
                  setView("feed");
                  setSourceMemoFocus(null);
                }}
                className={`p-0 text-3xl font-semibold leading-none tracking-tight transition-colors sm:text-4xl ${
                  view === "feed"
                    ? "text-black"
                    : "text-zinc-400 hover:text-zinc-500 hover:underline hover:underline-offset-4"
                }`}
              >
                Feed
              </button>
              <button
                onClick={() => {
                  setView("sources");
                  setSnbOpen(false);
                }}
                className={`p-0 text-3xl font-semibold leading-none tracking-tight transition-colors sm:text-4xl ${
                  view === "sources"
                    ? "text-black"
                    : "text-zinc-400 hover:text-zinc-500 hover:underline hover:underline-offset-4"
                }`}
              >
                My
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* Mobile SNB toggle */}
              {view === "feed" && (
                <button
                  type="button"
                  onClick={() => setSnbOpen(true)}
                  className="lg:hidden flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  aria-label="날짜 보기"
                >
                  <i className="ri-calendar-line text-sm" />
                </button>
              )}
              {/* Account button */}
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                {authUser.avatarUrl ? (
                  <img src={authUser.avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                ) : (
                  <i className="ri-user-line text-xs" />
                )}
                <span className="max-w-[100px] truncate hidden sm:block">{authUser.displayName ?? authUser.email}</span>
              </button>
            </div>
          </div>
        </div>
        )}
        {sourceMemoFocus && (
          <div className="mb-6 pt-2 sm:mb-8 sm:pt-3">
            <button
              type="button"
              onClick={backToMyFromSourceFeed}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              <i className="ri-arrow-left-line text-sm" />
              MY로 돌아가기
            </button>
          </div>
        )}
        {view === "feed" && (
          <header className="mb-8 flex flex-col gap-3 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`title-${sourceMemoFocus ? `source-${sourceMemoFocus.id}` : selectedDate}`}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  {sourceMemoFocus ? (
                    <>
                      <p className="text-xs text-muted-foreground">소스별 탐색</p>
                      <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight sm:text-xl">
                        {sourceMemoFocus.name}에서 노출된 피드
                      </h1>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">{displayedDate}</p>
                      <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight sm:text-xl">{heroTitle}</h1>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            {sourceMemoFocus ? null : (
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
            )}
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
              refreshingSourceIds={refreshingSourceIds}
              onRefreshSource={refreshSource}
              onOpenSourceMemos={(source) => void loadSourceMemoFeed(source.id, source.name)}
              onboardingHosts={onboardingHosts}
              onboardingSourceIds={onboardingSourceIds}
              pendingSourceIds={pendingSourceIds}
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
                  <div key={item.id} className="flex flex-col gap-3">
                    <div className="relative">
                      {replacingIds.has(item.id) ? (
                        <CardSkeleton />
                      ) : (
                        <FeedCard
                          {...item}
                          index={i}
                          dimThumbnail={!isToday && !memoItemIds.has(item.id)}
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
                          onReport={(payload) => reportContent(item.id, payload)}
                        />
                      )}
                      {skipReasonItemId === item.id && (
                        <div
                          className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-white/88 px-3 py-4 backdrop-blur-[4px]"
                          onClick={() => setSkipReasonItemId(null)}
                        >
                          <div
                            className="w-full max-w-[250px] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-zinc-900">보고 싶지 않은 이유를 알려 주세요</p>
                              <button
                                type="button"
                                onClick={() => setSkipReasonItemId(null)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                                aria-label="닫기"
                              >
                                <i className="ri-close-line text-sm" />
                              </button>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const id = skipReasonItemId;
                                  setSkipReasonItemId(null);
                                  if (id != null) void skip(id, "resurface_later");
                                }}
                                className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50"
                              >
                                다른 날 다시 추천
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const id = skipReasonItemId;
                                  setSkipReasonItemId(null);
                                  if (id != null) void skip(id, "not_my_interest");
                                }}
                                className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50"
                              >
                                관심 분야 아님
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {isToday && !sourceMemoFocus && !memoItemIds.has(item.id) && skipReasonItemId !== item.id && (
                      <button
                        onClick={() => setSkipReasonItemId(item.id)}
                        disabled={replacingIds.has(item.id)}
                        className="text-xs text-zinc-600 hover:text-zinc-700 transition-colors text-center py-1 disabled:opacity-0"
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
        </div>
      </div>
      <AppToast
        toast={toast}
        sourceSubmitting={sourceSubmitting}
        onClose={() => setToast(null)}
        onUndo={() => toast?.undoFn?.()}
        onRetry={retryFailedSources}
      />
      {accountOpen && authUser && (
        <AccountPanel
          user={authUser}
          onClose={() => setAccountOpen(false)}
          onLogout={() => {
            setAuthUser(null);
            setItems([]);
            setSources([]);
            setAccountOpen(false);
          }}
          onDeleted={() => {
            setAuthUser(null);
            setItems([]);
            setSources([]);
            setAccountOpen(false);
          }}
        />
      )}
      {showIntro && <SpiralDemo onComplete={handleIntroComplete} />}
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
