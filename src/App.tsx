import { useEffect, useState } from "react";
import FeedCard, { FeedItem } from "@/components/FeedCard";

export default function App() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [reacted, setReacted] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feed/today")
      .then((r) => r.json() as Promise<{ items: FeedItem[] }>)
      .then((data) => setItems(data.items ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const react = async (id: number, type: "keep" | "skip") => {
    setReacted((prev) => new Set(prev).add(id));
    await fetch("/api/reaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: id, type }),
    });
  };

  const visible = items.filter((i) => !reacted.has(i.id));

  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto flex w-full max-w-[390px] flex-col gap-4">
        {loading ? (
          <p className="text-center text-sm text-muted-foreground">불러오는 중...</p>
        ) : visible.length === 0 ? (
          <EmptyState hasItems={items.length > 0} />
        ) : (
          visible.map((item, i) => (
            <FeedCard
              key={item.id}
              {...item}
              index={i}
              onKeep={(id) => react(id, "keep")}
              onSkip={(id) => react(id, "skip")}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <i className="ri-inbox-line text-4xl text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {hasItems ? "오늘 카드를 다 봤어요" : "아직 콘텐츠가 없어요"}
      </p>
    </div>
  );
}
