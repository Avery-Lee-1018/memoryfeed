import { useState } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// fallback: /public/thumbnails/ 에 01.png, 02.png, 03.png 저장 필요
const FALLBACK_THUMBNAILS = [
  "/thumbnails/01.png",
  "/thumbnails/02.png",
  "/thumbnails/03.png",
];

export type FeedItem = {
  id: number;
  title: string;
  url: string;
  summary?: string | null;
  thumbnail_url?: string | null;
  sourceName: string;
  sourceType: "rss" | "blog";
};

type Props = FeedItem & {
  index?: number;
  onKeep: (id: number) => void;
  onSkip: (id: number) => void;
};

export default function FeedCard({
  id,
  title,
  url,
  summary,
  thumbnail_url,
  sourceName,
  sourceType,
  index = 0,
  onKeep,
  onSkip,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const thumbnail = thumbnail_url ?? FALLBACK_THUMBNAILS[index % 3];

  return (
    <Card className="w-full overflow-hidden rounded-2xl border-0 shadow-sm">
      {/* Thumbnail */}
      <div className="h-[201px] w-full overflow-hidden">
        <img src={thumbnail} alt="" className="h-full w-full object-cover" />
      </div>

      {/* Header */}
      <CardHeader className="pb-2 pt-4">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <i className={sourceType === "rss" ? "ri-rss-line" : "ri-links-line"} />
          {sourceName}
        </p>
        <h2 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight">
          {title}
        </h2>
      </CardHeader>

      {/* Highlight */}
      {summary && (
        <CardContent className="pb-2 pt-0">
          <p className={`text-sm text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}>
            {summary}
          </p>
          {!expanded && summary.length > 120 && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 text-xs text-foreground/50 hover:text-foreground/80"
            >
              더 보기
            </button>
          )}
        </CardContent>
      )}

      {/* Actions */}
      <CardFooter className="flex items-center justify-between px-4 pb-4 pt-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSkip(id)}
          className="h-10 w-10 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <i className="ri-close-line text-xl" />
        </Button>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
        >
          <i className="ri-external-link-line text-xl" />
        </a>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => onKeep(id)}
          className="h-10 w-10 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
        >
          <i className="ri-check-line text-xl" />
        </Button>
      </CardFooter>
    </Card>
  );
}
