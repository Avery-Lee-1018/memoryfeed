import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import CardSkeleton from "@/components/CardSkeleton";

const SKELETON_MIN_MS = 500;

const TITLE_CANDIDATES = [
  "기억을 수면 위로 떠올린다",
  "오늘의 영감을 저장한다",
  "어제의 인사이트를 다시 꺼낸다",
  "흘려보낸 아이디어를 다시 붙잡는다",
  "작은 메모를 오늘의 힌트로 바꾼다",
  "쌓아둔 링크를 지금의 생각으로 연결한다",
  "기억의 단서를 오늘의 실행으로 이어간다",
  "지나친 콘텐츠를 다시 내 편으로 만든다",
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
  const seed = isoDate
    .replaceAll("-", "")
    .split("")
    .reduce((acc, cur) => acc + Number(cur), 0);
  return TITLE_CANDIDATES[seed % TITLE_CANDIDATES.length];
};

export default function App() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [initialItemCount, setInitialItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [replacingIds, setReplacingIds] = useState<Set<number>>(new Set());
  const [memoItemIds, setMemoItemIds] = useState<Set<number>>(new Set());
  const [selectedDate, setSelectedDate] = useState(toIsoDate(new Date()));
  const [dateDirection, setDateDirection] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/feed/today?date=${selectedDate}`)
      .then((r) => r.json() as Promise<{ items: FeedItem[] }>)
      .then((data) => {
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setInitialItemCount(nextItems.length);
        setReplacingIds(new Set());
        setMemoItemIds(new Set(nextItems.filter(i => !!i.note?.trim()).map(i => i.id)));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const skip = async (id: number) => {
    const currentItemIds = items.map((item) => item.id);
    const startedAt = Date.now();
    setReplacingIds((prev) => new Set(prev).add(id));

    await fetch("/api/reaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: id, type: "skip" }),
    });

    const res = await fetch("/api/feed/replacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ excludeItemIds: currentItemIds, date: selectedDate }),
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
      if (!data.item) return prev.filter((item) => item.id !== id);
      const next = [...prev];
      next[targetIndex] = data.item;
      return next;
    });
  };

  const todayIso = toIsoDate(new Date());
  const isToday = selectedDate === todayIso;
  const displayedDate = new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const heroTitle = useMemo(() => getTitleForDate(selectedDate), [selectedDate]);
  const slideFrom = dateDirection >= 0 ? 20 : -20;
  const slideTo = -slideFrom;

  const moveDate = (delta: number) => {
    setDateDirection(delta);
    setSelectedDate((prev) => shiftDate(prev, delta));
  };

  const moveToToday = () => {
    if (isToday) return;
    setDateDirection(selectedDate < todayIso ? 1 : -1);
    setSelectedDate(todayIso);
  };

  return (
    <div className="flex min-h-dvh items-center bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-[1160px]">
        <header className="mb-6 flex items-end justify-between">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`title-${selectedDate}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <p className="text-xs text-muted-foreground">{displayedDate}</p>
              <h1 className="mt-1 text-xl font-semibold leading-snug tracking-tight">{heroTitle}</h1>
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center gap-1 pb-0.5">
            <button
              onClick={() => moveDate(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="이전 날짜"
            >
              <i className="ri-arrow-left-s-line" />
            </button>
            <button
              onClick={() => moveDate(1)}
              disabled={isToday}
              className="flex h-7 w-7 items-center justify-center rounded-full text-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="다음 날짜"
            >
              <i className="ri-arrow-right-s-line" />
            </button>
            <button
              onClick={moveToToday}
              disabled={isToday}
              className="ml-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="오늘로 이동"
            >
              TODAY
            </button>
          </div>
        </header>

        <div className="min-h-[560px]">
          <AnimatePresence mode="wait" initial={false}>
            {loading ? (
              <motion.div
                key={`loading-${selectedDate}`}
                initial={{ opacity: 0, x: slideFrom }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: slideTo }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="grid grid-cols-3 gap-5"
              >
                {[0, 1, 2].map((i) => (
                  <CardSkeleton key={i} />
                ))}
              </motion.div>
            ) : items.length === 0 ? (
              <motion.div
                key={`empty-${selectedDate}`}
                initial={{ opacity: 0, x: slideFrom }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: slideTo }}
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                <EmptyState hasItems={initialItemCount > 0} />
              </motion.div>
            ) : (
              <motion.div
                key={`cards-${selectedDate}`}
                initial={{ opacity: 0, x: slideFrom }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: slideTo }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="grid grid-cols-3 gap-5"
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
                          setMemoItemIds((prev) => new Set(prev).add(item.id))
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
                    {!memoItemIds.has(item.id) && (
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
        </div>
      </div>
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
