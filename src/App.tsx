import { useEffect, useState } from "react";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";

export default function App() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feed/today")
      .then((r) => r.json() as Promise<{ items: FeedItem[] }>)
      .then((data) => setItems(data.items ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const react = async (id: number, type: "keep" | "skip") => {
    await fetch("/api/reaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: id, type }),
    });
    setIndex((i) => i + 1);
  };

  const current = items[index];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-[390px]">
        {loading ? (
          <p className="text-center text-sm text-muted-foreground">불러오는 중...</p>
        ) : !current ? (
          <EmptyState hasItems={items.length > 0} onReset={() => setIndex(0)} />
        ) : (
          <FeedCard
            key={current.id}
            {...current}
            index={index}
            onKeep={(id) => react(id, "keep")}
            onSkip={(id) => react(id, "skip")}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasItems, onReset }: { hasItems: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <i className="ri-inbox-line text-4xl text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        {hasItems ? "오늘 카드를 다 봤어요" : "아직 콘텐츠가 없어요"}
      </p>
      {hasItems && (
        <Button variant="outline" size="sm" onClick={onReset}>
          처음부터 보기
        </Button>
      )}
    </div>
  );
}
