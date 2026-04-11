import { useEffect, useState } from "react";
import FeedCard, { FeedItem } from "@/components/FeedCard";

export default function App() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [initialItemCount, setInitialItemCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feed/today")
      .then((r) => r.json() as Promise<{ items: FeedItem[] }>)
      .then((data) => {
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setInitialItemCount(nextItems.length);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const skip = async (id: number) => {
    const currentItemIds = items.map((item) => item.id);

    await fetch("/api/reaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: id, type: "skip" }),
    });

    const res = await fetch("/api/feed/replacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ excludeItemIds: currentItemIds }),
    });
    const data = (await res.json()) as { item?: FeedItem | null };

    setItems((prev) => {
      const targetIndex = prev.findIndex((item) => item.id === id);
      if (targetIndex === -1) return prev;
      if (!data.item) return prev.filter((item) => item.id !== id);
      const next = [...prev];
      next[targetIndex] = data.item;
      return next;
    });
  };

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background">
      <div className="w-full">
        {/* Header */}
        <header className="mx-auto max-w-[390px] px-6 pb-5 pt-2">
          <p className="text-xs text-muted-foreground">{today}</p>
          <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight">
            오늘 기억할 콘텐츠를<br />확인할까요?
          </h1>
        </header>

        {/* Card Scroll */}
        {loading ? (
          <p className="px-6 text-center text-sm text-muted-foreground">불러오는 중...</p>
        ) : items.length === 0 ? (
          <EmptyState hasItems={initialItemCount > 0} />
        ) : (
          <div className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory px-6 pb-4 no-scrollbar">
            {items.map((item, i) => (
              <div
                key={item.id}
                className="snap-center shrink-0 w-[82vw] max-w-[340px] flex flex-col gap-2"
              >
                <FeedCard {...item} index={i} />
                <button
                  onClick={() => skip(item.id)}
                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors text-center py-1"
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
    <div className="flex flex-col items-center gap-2 py-16 px-6 text-center">
      <i className="ri-inbox-line text-4xl text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {hasItems ? "오늘 카드를 다 봤어요" : "아직 콘텐츠가 없어요"}
      </p>
    </div>
  );
}
