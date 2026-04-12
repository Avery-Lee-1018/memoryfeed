import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const THUMBNAIL_FALLBACK_TIMEOUT_MS = 2600;

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
  note?: string | null;
  sourceName: string;
  sourceType: "rss" | "blog";
};

type Props = FeedItem & {
  index?: number;
  onMemoSaved?: () => void;
  onMemoDeleted?: () => void;
};

export default function FeedCard({
  id,
  title,
  url,
  summary,
  thumbnail_url,
  note,
  sourceName,
  sourceType,
  index = 0,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const fallbackThumbnail = FALLBACK_THUMBNAILS[id % 3];
  const resolvedThumbnail = useMemo(() => {
    const params = new URLSearchParams();
    params.set("pageUrl", url);
    if (thumbnail_url) params.set("imageUrl", thumbnail_url);
    return `/api/thumbnail?${params.toString()}`;
  }, [url, thumbnail_url]);
  const [thumbnailSrc, setThumbnailSrc] = useState(resolvedThumbnail);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setThumbnailSrc(resolvedThumbnail);
    setImageLoaded(false);
  }, [resolvedThumbnail]);

  useEffect(() => {
    if (thumbnailSrc !== resolvedThumbnail || imageLoaded) return;
    const timer = window.setTimeout(() => {
      setThumbnailSrc((c) => (c === resolvedThumbnail ? fallbackThumbnail : c));
    }, THUMBNAIL_FALLBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [thumbnailSrc, resolvedThumbnail, fallbackThumbnail, imageLoaded]);

  // suppress unused-var warnings for callbacks kept for future use
  void note; void id;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
      tabIndex={0}
    >
      <Card className="relative z-30 w-full cursor-pointer overflow-hidden rounded-2xl border-0 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        {/* Thumbnail */}
        <div className="relative h-[201px] w-full overflow-hidden">
          {!imageLoaded && (
            <div className="absolute inset-0 animate-pulse bg-gray-200" />
          )}
          <img
            src={thumbnailSrc}
            alt=""
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              if (thumbnailSrc !== fallbackThumbnail) setThumbnailSrc(fallbackThumbnail);
              else setImageLoaded(true);
            }}
            onLoad={() => setImageLoaded(true)}
          />
        </div>

        {/* Header */}
        <CardHeader className="pb-2 pt-4">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {sourceType === "rss" && <i className="ri-rss-line opacity-50" />}
            {sourceName}
          </p>
          <h2 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight">
            {title}
          </h2>
        </CardHeader>

        {/* Summary */}
        {summary && (
          <CardContent className="pb-5 pt-0">
            <p className={`text-sm text-muted-foreground/80 ${expanded ? "" : "line-clamp-4"}`}>
              {summary}
            </p>
            {!expanded && summary.length > 160 && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(true); }}
                className="mt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
              >
                더 보기
              </button>
            )}
          </CardContent>
        )}
      </Card>
    </a>
  );
}
