import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import CardSkeleton from "@/components/CardSkeleton";
import MemoShapes from "@/components/MemoShapes";

const SKELETON_MIN_MS = 500;

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
  const hashDate = (date: string) =>
    date
      .replaceAll("-", "")
      .split("")
      .reduce((acc, cur, idx) => acc + Number(cur) * (idx + 3), 17);

  const prevDate = shiftDate(isoDate, -1);
  let idx = hashDate(isoDate) % TITLE_CANDIDATES.length;
  const prevIdx = hashDate(prevDate) % TITLE_CANDIDATES.length;

  if (idx === prevIdx) {
    idx = (idx + 1) % TITLE_CANDIDATES.length;
  }

  return TITLE_CANDIDATES[idx];
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

  const moveItemToLeft = (itemId: number) => {
    setItems((prev) => {
      const idx = prev.findIndex((item) => item.id === itemId);
      if (idx <= 0) return prev;
      const target = prev[idx];
      return [target, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  };

  const hasMemoToday = memoItemIds.size > 0;

  return (
    <div className="flex min-h-dvh items-start bg-background px-3 py-4 md:items-center md:px-4 md:py-6">
      <MemoShapes show={hasMemoToday} dateKey={selectedDate} />
      <div className="relative z-10 mx-auto w-full max-w-[1160px]">
        <header className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`title-${selectedDate}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <p className="text-xs text-muted-foreground">{displayedDate}</p>
              <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight sm:text-xl">{heroTitle}</h1>
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center gap-1 self-start pb-0.5 sm:self-auto">
            <button
              onClick={() => moveDate(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-colors sm:h-7 sm:w-7 sm:text-lg"
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
              className="ml-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="오늘로 이동"
            >
              TODAY
            </button>
          </div>
        </header>

        <div className="min-h-[520px] sm:min-h-[560px]">
          <AnimatePresence mode="wait" initial={false}>
            {loading ? (
              <motion.div
                key={`loading-${selectedDate}`}
                initial={{ opacity: 0, x: slideFrom }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: slideTo }}
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
