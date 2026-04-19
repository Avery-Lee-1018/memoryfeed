import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authorizedFetch, readJson } from "@/lib/api";

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
  hasNote?: boolean;
  sourceName: string;
  sourceType: "rss" | "blog";
};

type Props = FeedItem & {
  index?: number;
  dimThumbnail?: boolean;
  onMemoSaved?: () => void;
  onMemoDeleted?: () => void;
};

export default function FeedCard({
  id,
  title,
  url,
  summary,
  thumbnail_url,
  hasNote,
  sourceName,
  sourceType,
  index = 0,
  dimThumbnail = false,
  onMemoSaved,
  onMemoDeleted,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [savedMemo, setSavedMemo] = useState("");
  const [draftMemo, setDraftMemo] = useState("");
  const [memoLoaded, setMemoLoaded] = useState(!hasNote);
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
    let revokedUrl: string | null = null;
    let cancelled = false;

    setImageLoaded(false);

    (async () => {
      try {
        const res = await authorizedFetch(resolvedThumbnail);
        if (!res.ok) throw new Error(`thumbnail_fetch_failed_${res.status}`);
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) throw new Error("thumbnail_not_image");
        const blob = await res.blob();
        if (cancelled) return;
        revokedUrl = URL.createObjectURL(blob);
        setThumbnailSrc(revokedUrl);
      } catch {
        if (cancelled) return;
        setThumbnailSrc(fallbackThumbnail);
      }
    })();

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [resolvedThumbnail, fallbackThumbnail]);

  // suppress unused-var warning for index kept for future use
  void index;

  const hasMemo = savedMemo.length > 0 || !!hasNote;

  const loadNote = async () => {
    if (memoLoaded) return;
    try {
      const res = await authorizedFetch(`/api/notes/${id}`);
      if (res.ok) {
        const data = await readJson<{ content?: string }>(res);
        const content = (data.content ?? "").trim();
        setSavedMemo(content);
        setDraftMemo(content);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setMemoLoaded(true);
    }
  };

  const openMemo = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!memoOpen) {
      await loadNote();
    }
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
      await authorizedFetch(`/api/notes/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draftMemo.trim() }),
      });
      setSavedMemo(draftMemo.trim());
      setMemoEditing(false);
      setMemoLoaded(true);
      onMemoSaved?.();
    } finally {
      setMemoSaving(false);
    }
  };

  const handleDelete = async () => {
    await authorizedFetch(`/api/notes/${id}`, { method: "DELETE" });
    setSavedMemo("");
    setDraftMemo("");
    setMemoLoaded(true);
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
              } ${dimThumbnail ? "brightness-75 saturate-75" : ""}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => {
                if (thumbnailSrc !== fallbackThumbnail) setThumbnailSrc(fallbackThumbnail);
                else setImageLoaded(true);
              }}
              onLoad={() => setImageLoaded(true)}
            />
            {dimThumbnail && (
              <div className="pointer-events-none absolute inset-0 bg-white/20" />
            )}
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
            <CardContent className="pb-3 pt-0">
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

          {/* Card footer — memo button sits here, fully below content */}
          <div className="flex justify-end px-4 pb-4 pt-1">
            <button
              onClick={openMemo}
              className={`flex items-center justify-center rounded-xl px-2 py-2 transition-colors ${
                hasMemo
                  ? "bg-amber-50 text-amber-500 hover:bg-amber-100"
                  : "bg-[#F2F2F3] text-muted-foreground/50 hover:bg-[#EBEBEC] hover:text-muted-foreground/80"
              }`}
              style={{ minWidth: 44, minHeight: 44 }}
              aria-label="메모"
            >
              <i className={`text-base ${hasMemo ? "ri-sticky-note-2-fill" : "ri-sticky-note-add-line"}`} />
            </button>
          </div>
        </Card>
      </a>

      {/* Memo panel — outside <a> to avoid link conflict */}
      {memoOpen && (
        <div className="mt-1.5 rounded-2xl bg-white px-4 py-3 shadow-sm">
          {memoEditing ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="rounded-full border border-zinc-200 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-zinc-50"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={memoSaving || !draftMemo.trim()}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    draftMemo.trim() && !memoSaving
                      ? "bg-zinc-900 text-white hover:bg-zinc-700 cursor-pointer"
                      : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                  }`}
                >
                  {memoSaving ? "저장 중…" : "저장"}
                </button>
              </div>
              <textarea
                autoFocus
                value={draftMemo}
                onChange={(e) => setDraftMemo(e.target.value)}
                placeholder="메모를 남겨보세요"
                className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-zinc-200"
                rows={3}
              />
            </div>
          ) : (
            <div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{savedMemo}</p>
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
