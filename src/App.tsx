import { useState } from "react";
import FeedCard, { FeedItem } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";

const MOCK_ITEMS: FeedItem[] = [
  {
    id: 1,
    title: "제품 방향이 흐려질 때 다시 보는 원칙 메모",
    url: "https://example.com/1",
    summary: "관리 도구가 아니라 다시 보게 만드는 경험에 집중한다.",
    thumbnail_url: "/thumbnails/01.png",
    sourceName: "Product Principles",
    sourceType: "rss",
  },
  {
    id: 2,
    title: "MVP 범위 체크: 지금 하지 않을 것 명확히 하기",
    url: "https://example.com/2",
    summary: "추천 고도화, 태그 기반 필터, 소스 추천은 뒤로 미룬다.",
    thumbnail_url: "/thumbnails/02.png",
    sourceName: "MVP Scope",
    sourceType: "rss",
  },
  {
    id: 3,
    title: "오늘의 3개 카드 경험을 위한 최소 구조 점검",
    url: "https://example.com/3",
    summary: "Cloudflare Worker + D1 + 단순한 카드 인터랙션으로 시작한다.",
    thumbnail_url: "/thumbnails/03.png",
    sourceName: "Architecture",
    sourceType: "rss",
  },
];

export default function App() {
  const [items] = useState<FeedItem[]>(MOCK_ITEMS);
  const [index, setIndex] = useState(0);

  const react = async (id: number, type: "keep" | "skip") => {
    void id;
    void type;
    setIndex((i) => i + 1);
  };

  const current = items[index];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-[390px]">
        <p className="mb-3 text-center text-xs text-muted-foreground">MVP Demo Home</p>
        {!current ? (
          <EmptyState hasItems={items.length > 0} />
        ) : (
          <FeedCard
            key={current.id}
            {...current}
            index={index}
            onKeep={(id) => react(id, "keep")}
            onSkip={(id) => react(id, "skip")}
          />
        )}
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIndex(0)}
            disabled={index === 0}
          >
            처음부터 보기
          </Button>
        </div>
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
