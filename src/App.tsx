import { useEffect, useState } from "react";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import CardSkeleton from "@/components/CardSkeleton";

const SKELETON_MIN_MS = 500;

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
const shiftDate = (isoDate: string, deltaDays: number) => {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toIsoDate(date);
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

  const displayedDate = new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const todayIso = toIsoDate(new Date());
  const isToday = selectedDate === todayIso;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background">
      <div className="w-full">
        <header className="mx-auto max-w-[390px] px-6 pb-5 pt-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{displayedDate}</p>
            <button
              onClick={() => setSelectedDate(todayIso)}
              disabled={isToday}
              className="rounded-full border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="오늘로 이동"
            >
              TODAY
            </button>
          </div>
          <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight">
            날짜별로 저장된 콘텐츠를<br />확인할까요?
          </h1>
        </header>

        <div className="mx-auto flex w-full max-w-[520px] items-start gap-2 px-2">
          <button
            onClick={() => setSelectedDate((prev) => shiftDate(prev, -1))}
            className="mt-28 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-background text-2xl text-foreground hover:bg-accent"
            aria-label="이전 날짜"
          >
            <i className="ri-arrow-left-s-line" />
          </button>

          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="mx-auto max-w-[390px] px-6">
                <p className="text-center text-sm text-muted-foreground">불러오는 중...</p>
              </div>
            ) : items.length === 0 ? (
              <EmptyState hasItems={initialItemCount > 0} />
            ) : (
              <div className="mx-auto max-w-[390px] overflow-x-auto no-scrollbar">
                <div className="flex gap-3 snap-x snap-mandatory px-6 pb-4">
                  {items.map((item, i) => (
                    <div
                      key={item.id}
                      className="snap-center shrink-0 w-[82vw] max-w-[340px] flex flex-col gap-2"
                    >
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
              </div>
            )}
          </div>

          <button
            onClick={() => setSelectedDate((prev) => shiftDate(prev, 1))}
            disabled={isToday}
            className="mt-28 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-background text-2xl text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="다음 날짜"
          >
            <i className="ri-arrow-right-s-line" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 px-6 text-center">
      <i className="ri-inbox-line text-4xl text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {hasItems ? "해당 날짜 카드를 다 봤어요" : "해당 날짜 콘텐츠가 없어요"}
      </p>
    </div>
  );
}
