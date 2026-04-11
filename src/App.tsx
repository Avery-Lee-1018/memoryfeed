import { useEffect, useState } from "react";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import CardSkeleton from "@/components/CardSkeleton";

const SKELETON_MIN_MS = 500;

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
const shiftDate = (isoDate: string, deltaDays: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return toIsoDate(d);
};

export default function App() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [initialItemCount, setInitialItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [replacingIds, setReplacingIds] = useState<Set<number>>(new Set());
  const [selectedDate, setSelectedDate] = useState(toIsoDate(new Date()));

  useEffect(() => {
    setLoading(true);
    fetch(`/api/feed/today?date=${selectedDate}`)
      .then((r) => r.json() as Promise<{ items: FeedItem[] }>)
      .then((data) => {
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setInitialItemCount(nextItems.length);
        setReplacingIds(new Set());
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

    setReplacingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
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

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-[1120px] px-8 py-10">

        {/* Header */}
        <header className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{displayedDate}</p>
            <h1 className="mt-1 text-xl font-semibold leading-snug tracking-tight">
              오늘 기억할 콘텐츠를 확인할까요?
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDate((prev) => shiftDate(prev, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground"
              aria-label="이전 날짜"
            >
              <i className="ri-arrow-left-s-line text-lg" />
            </button>
            <button
              onClick={() => setSelectedDate(todayIso)}
              disabled={isToday}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              TODAY
            </button>
            <button
              onClick={() => setSelectedDate((prev) => shiftDate(prev, 1))}
              disabled={isToday}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="다음 날짜"
            >
              <i className="ri-arrow-right-s-line text-lg" />
            </button>
          </div>
        </header>

        {/* Cards */}
        {loading ? (
          <div className="grid grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState hasItems={initialItemCount > 0} />
        ) : (
          <div className="grid grid-cols-3 gap-5">
            {items.map((item, i) => (
              <div key={item.id} className="flex flex-col gap-2">
                {replacingIds.has(item.id) ? (
                  <CardSkeleton />
                ) : (
                  <FeedCard {...item} index={i} />
                )}
                <button
                  onClick={() => skip(item.id)}
                  disabled={replacingIds.has(item.id)}
                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors text-center py-1 disabled:opacity-0"
                >
                  오늘은 안볼래요
                </button>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

function EmptyState({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <i className="ri-inbox-line text-4xl text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {hasItems ? "오늘 카드를 다 봤어요" : "아직 콘텐츠가 없어요"}
      </p>
    </div>
  );
}
