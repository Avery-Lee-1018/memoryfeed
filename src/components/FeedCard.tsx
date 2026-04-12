import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { marked } from "marked";

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
  onMemoSaved,
  onMemoDeleted,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [savedMemo, setSavedMemo] = useState(note?.trim() ?? "");
  const [draftMemo, setDraftMemo] = useState(note?.trim() ?? "");
  const [memoSaving, setMemoSaving] = useState(false);

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

  // suppress unused-var warning for index kept for future use
  void index;

  const hasMemo = savedMemo.length > 0;

  const openMemo = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!memoOpen) {
      setDraftMemo(savedMemo);
      setMemoEditing(!hasMemo); // open in edit mode if no memo yet
    }
    setMemoOpen((prev) => !prev);
  };

  const handleSave = async () => {
    if (!draftMemo.trim()) return;
    setMemoSaving(true);
    try {
      await fetch(`/api/notes/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draftMemo.trim() }),
      });
      setSavedMemo(draftMemo.trim());
      setMemoEditing(false);
      onMemoSaved?.();
    } finally {
      setMemoSaving(false);
    }
  };

  const handleDelete = async () => {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setSavedMemo("");
    setDraftMemo("");
    setMemoEditing(false);
    setMemoOpen(false);
    onMemoDeleted?.();
  };

  const handleCancelEdit = () => {
    setDraftMemo(savedMemo);
    setMemoEditing(false);
    if (!hasMemo) setMemoOpen(false);
  };

  return (
    <div className="flex flex-col">
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

          {/* Memo toggle — floating bottom-right, inside card but stops propagation */}
          <button
            onClick={openMemo}
            className={`absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              hasMemo
                ? "bg-amber-50 text-amber-500 hover:bg-amber-100"
                : "text-muted-foreground/35 hover:bg-accent hover:text-muted-foreground/70"
            }`}
            aria-label="메모"
          >
            <i className={`text-sm ${hasMemo ? "ri-sticky-note-2-fill" : "ri-sticky-note-2-line"}`} />
          </button>
        </Card>
      </a>

      {/* Memo panel — outside <a> to avoid link conflict */}
      {memoOpen && (
        <div className="mt-1.5 rounded-2xl bg-white px-4 py-3 shadow-sm">
          {memoEditing ? (
            <div className="flex flex-col gap-2.5">
              <textarea
                autoFocus
                value={draftMemo}
                onChange={(e) => setDraftMemo(e.target.value)}
                placeholder="메모를 남겨보세요 (마크다운 지원)"
                className="w-full resize-none rounded-xl border border-border bg-zinc-50 p-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                rows={3}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={memoSaving || !draftMemo.trim()}
                  className="rounded-full bg-foreground px-3.5 py-1 text-xs font-medium text-white transition-colors hover:bg-foreground/80 disabled:opacity-40"
                >
                  {memoSaving ? "저장 중…" : "저장"}
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div
                className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground/80"
                dangerouslySetInnerHTML={{ __html: marked.parse(savedMemo) as string }}
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={() => { setDraftMemo(savedMemo); setMemoEditing(true); }}
                  className="text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                >
                  수정
                </button>
                <button
                  onClick={handleDelete}
                  className="text-xs text-muted-foreground/50 transition-colors hover:text-rose-500"
                >
                  삭제
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
