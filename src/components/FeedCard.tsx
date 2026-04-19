import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authorizedFetch, readJson } from "@/lib/api";

const FALLBACK_THUMBNAILS = [
  "/thumbnails/01.png",
  "/thumbnails/02.png",
  "/thumbnails/03.png",
];

const thumbnailObjectUrlCache = new Map<string, string>();
const thumbnailInflightCache = new Map<string, Promise<string | null>>();
const MAX_THUMBNAIL_CACHE = 220;

function setThumbnailCache(key: string, objectUrl: string) {
  if (!thumbnailObjectUrlCache.has(key) && thumbnailObjectUrlCache.size >= MAX_THUMBNAIL_CACHE) {
    const oldest = thumbnailObjectUrlCache.keys().next().value as string | undefined;
    if (oldest) {
      const revoked = thumbnailObjectUrlCache.get(oldest);
      if (revoked) URL.revokeObjectURL(revoked);
      thumbnailObjectUrlCache.delete(oldest);
    }
  }
  thumbnailObjectUrlCache.set(key, objectUrl);
}

async function fetchAuthorizedThumbnailObjectUrl(url: string) {
  const cached = thumbnailObjectUrlCache.get(url);
  if (cached) return cached;

  const inflight = thumbnailInflightCache.get(url);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const res = await authorizedFetch(url);
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) return null;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setThumbnailCache(url, objectUrl);
      return objectUrl;
    } catch {
      return null;
    } finally {
      thumbnailInflightCache.delete(url);
    }
  })();
  thumbnailInflightCache.set(url, task);
  return task;
}

export type FeedItem = {
  id: number;
  title: string;
  url: string;
  summary?: string | null;
  thumbnail_url?: string | null;
  tags?: string[];
  hasNote?: boolean;
  sourceName: string;
  sourceType: "rss" | "blog";
};

type Props = FeedItem & {
  index?: number;
  dimThumbnail?: boolean;
  onTagClick?: (tag: string) => void;
  onMemoSaved?: () => void;
  onMemoDeleted?: () => void;
  onReport?: (payload: { issues: string[]; details?: string }) => Promise<void>;
};

type RelatedItem = {
  id: number;
  title: string;
  url: string;
  sourceName: string;
  sharedTagCount?: number;
};

const TAG_THEMES = [
  "bg-rose-100 text-rose-800",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-orange-100 text-orange-800",
  "bg-lime-100 text-lime-800",
  "bg-cyan-100 text-cyan-800",
];

const pickRandomTagTheme = () => TAG_THEMES[Math.floor(Math.random() * TAG_THEMES.length)];

export default function FeedCard({
  id,
  title,
  url,
  summary,
  thumbnail_url,
  tags: initialTags,
  hasNote,
  sourceName,
  sourceType,
  index = 0,
  dimThumbnail = false,
  onTagClick,
  onMemoSaved,
  onMemoDeleted,
  onReport,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [savedMemo, setSavedMemo] = useState("");
  const [draftMemo, setDraftMemo] = useState("");
  const [memoLoaded, setMemoLoaded] = useState(!hasNote);
  const [memoSaving, setMemoSaving] = useState(false);
  const [hasMemoState, setHasMemoState] = useState(!!hasNote);
  const [tags, setTags] = useState<string[]>(Array.isArray(initialTags) ? initialTags.slice(0, 12) : []);
  const [tagThemeByValue, setTagThemeByValue] = useState<Record<string, string>>({});
  const [recommendedTags, setRecommendedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isTagComposing, setIsTagComposing] = useState(false);
  const [relatedItems, setRelatedItems] = useState<RelatedItem[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportPhase, setReportPhase] = useState<"idle" | "issues" | "processing">("idle");
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [reportDetails, setReportDetails] = useState("");

  useEffect(() => {
    setTags(Array.isArray(initialTags) ? initialTags.slice(0, 12) : []);
  }, [id, initialTags]);

  useEffect(() => {
    setTagThemeByValue((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const tag of tags) {
        if (!next[tag]) {
          next[tag] = pickRandomTagTheme();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tags]);

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
    let cancelled = false;
    setImageLoaded(false);
    setThumbnailSrc(resolvedThumbnail);

    void (async () => {
      const objectUrl = await fetchAuthorizedThumbnailObjectUrl(resolvedThumbnail);
      if (cancelled) return;
      if (objectUrl) {
        setThumbnailSrc(objectUrl);
        return;
      }
      setThumbnailSrc(fallbackThumbnail);
      setImageLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedThumbnail, fallbackThumbnail]);

  // suppress unused-var warning for index kept for future use
  void index;

  const hasMemo = hasMemoState;

  const loadNote = async () => {
    if (memoLoaded) return;
    try {
      const res = await authorizedFetch(`/api/notes/${id}`);
      if (res.ok) {
        const data = await readJson<{ content?: string; tags?: string[]; recommendedTags?: string[] }>(res);
        const content = (data.content ?? "").trim();
        setSavedMemo(content);
        setDraftMemo(content);
        setHasMemoState(content.length > 0);
        setTags(Array.isArray(data.tags) ? data.tags.slice(0, 12) : []);
        setRecommendedTags(Array.isArray(data.recommendedTags) ? data.recommendedTags.slice(0, 8) : []);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setMemoLoaded(true);
    }
  };

  const loadRelated = async () => {
    setRelatedLoading(true);
    try {
      const res = await authorizedFetch(`/api/items/${id}/related`);
      if (!res.ok) {
        setRelatedItems([]);
        return;
      }
      const data = await readJson<{ items?: RelatedItem[] }>(res);
      setRelatedItems(data.items ?? []);
    } catch {
      setRelatedItems([]);
    } finally {
      setRelatedLoading(false);
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
      void loadRelated();
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
        body: JSON.stringify({ content: draftMemo.trim(), tags }),
      });
      setSavedMemo(draftMemo.trim());
      setHasMemoState(true);
      setMemoEditing(false);
      setMemoLoaded(true);
      void loadRelated();
      onMemoSaved?.();
    } finally {
      setMemoSaving(false);
    }
  };

  const handleDelete = async () => {
    await authorizedFetch(`/api/notes/${id}`, { method: "DELETE" });
    setSavedMemo("");
    setDraftMemo("");
    setHasMemoState(false);
    setMemoLoaded(true);
    setMemoEditing(false);
    setMemoOpen(false);
    setTags([]);
    setRelatedItems([]);
    onMemoDeleted?.();
  };

  const handleCancelEdit = () => {
    setDraftMemo(savedMemo);
    setMemoEditing(false);
    if (!hasMemo) setMemoOpen(false);
  };

  const commitTagInput = () => {
    if (isTagComposing) return;
    const entries = tagInput
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .map((v) => v.slice(0, 32));
    if (entries.length === 0) {
      setTagInput("");
      return;
    }
    setTags((prev) => {
      const set = new Set(prev);
      for (const e of entries) {
        if (set.size >= 12) break;
        set.add(e);
      }
      return [...set];
    });
    setTagInput("");
  };

  return (
    <div className="relative flex flex-col">
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
              } ${dimThumbnail ? "grayscale" : ""}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => {
                if (thumbnailSrc !== fallbackThumbnail) setThumbnailSrc(fallbackThumbnail);
                else setImageLoaded(true);
              }}
              onLoad={() => setImageLoaded(true)}
            />
            {/* ⋮ button — inside thumbnail so it translates with the card on hover */}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((m) => !m); }}
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50"
              aria-label="더 보기"
            >
              <i className="ri-more-fill text-sm leading-none" />
            </button>
          </div>

          {/* Header */}
          <CardHeader className="pb-2 pt-4">
            <p className="order-2 flex items-center gap-1 text-xs text-muted-foreground">
              {sourceType === "rss" && <i className="ri-rss-line opacity-50" />}
              {sourceName}
            </p>
            {tags.length > 0 && (
              <div className="order-1 mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    key={`top-${tag}`}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTagClick?.(tag);
                    }}
                    className={`rounded-md px-2 py-0.5 text-[11px] transition hover:brightness-95 ${
                      tagThemeByValue[tag] ?? TAG_THEMES[0]
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
            <h2 className="order-3 line-clamp-2 text-base font-semibold leading-snug tracking-tight">
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

      {/* Dropdown — outside <a> so it's not clipped by Card's overflow-hidden */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-2 top-10 z-50 min-w-[120px] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setSelectedIssues(new Set());
                setReportDetails("");
                setReportPhase("issues");
              }}
              className="w-full px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50"
            >
              콘텐츠 교체
            </button>
          </div>
        </>
      )}

      {/* Report issue overlay — outside <a> to avoid link navigation */}
      {reportPhase === "issues" && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-white/88 px-3 py-4 backdrop-blur-[4px]"
          onClick={() => setReportPhase("idle")}
        >
          <div
            className="w-full max-w-[250px] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-900">어떤 부분이 문제인가요?</p>
              <button
                type="button"
                onClick={() => setReportPhase("idle")}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                aria-label="닫기"
              >
                <i className="ri-close-line text-sm" />
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {[
                { key: "thumbnail", label: "썸네일" },
                { key: "title", label: "제목" },
                { key: "summary", label: "설명" },
                { key: "url", label: "랜딩 링크" },
              ].map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIssues.has(key)}
                    onChange={() =>
                      setSelectedIssues((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="h-4 w-4 cursor-pointer accent-zinc-800"
                  />
                  <span className="text-xs text-zinc-700">{label}</span>
                </label>
              ))}
              <textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="기타 의견 (선택)"
                className="mt-1 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-200"
                rows={2}
              />
            </div>
            <button
              type="button"
              disabled={selectedIssues.size === 0}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setReportPhase("processing");
                try {
                  await onReport?.({
                    issues: Array.from(selectedIssues),
                    details: reportDetails.trim() || undefined,
                  });
                } finally {
                  setReportPhase("idle");
                }
              }}
              className="mt-3 w-full rounded-lg bg-zinc-900 px-2.5 py-2 text-xs text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              신고하기
            </button>
          </div>
        </div>
      )}

      {reportPhase === "processing" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-white/88 backdrop-blur-[4px]">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
            <p className="text-xs text-zinc-600">콘텐츠 확인 중…</p>
          </div>
        </div>
      )}

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
              <div className="flex flex-wrap gap-x-1.5 gap-y-2">
                {recommendedTags.filter((t) => !tags.includes(t)).map((tag) => (
                  <button
                    key={`r-${tag}`}
                    type="button"
                    onClick={() => setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag].slice(0, 12)))}
                    className={`rounded-md px-2 py-0.5 text-[11px] transition-colors hover:brightness-95 ${tagThemeByValue[tag] ?? TAG_THEMES[0]}`}
                  >
                    + {tag}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onCompositionStart={() => setIsTagComposing(true)}
                  onCompositionEnd={() => setIsTagComposing(false)}
                  onKeyDown={(e) => {
                    // Guard IME composition to prevent duplicated Korean fragments.
                    if (isTagComposing || (e.nativeEvent as KeyboardEvent).isComposing) return;
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      commitTagInput();
                    }
                  }}
                  onBlur={() => {
                    // Avoid accidental half-composed token commit on blur.
                    if (isTagComposing) return;
                    if (tagInput.includes(",")) commitTagInput();
                  }}
                  placeholder="태그 입력 (쉼표로 구분)"
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-200"
                />
                {!!tagInput.trim() && (
                  <button
                    type="button"
                    onClick={commitTagInput}
                    className="inline-flex items-center rounded-md border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
                  >
                    생성: {tagInput.trim()}
                  </button>
                )}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-x-1.5 gap-y-2">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                        className={`rounded-md px-2 py-0.5 text-[11px] ${tagThemeByValue[tag] ?? TAG_THEMES[0]}`}
                      >
                        {tag} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{savedMemo}</p>
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-zinc-500">같은 주제 모음</p>
                {relatedLoading ? (
                  <p className="mt-1 text-[11px] text-zinc-400">불러오는 중…</p>
                ) : relatedItems.length === 0 ? (
                  <p className="mt-1 text-[11px] text-zinc-400">아직 연결된 콘텐츠가 없어요</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {relatedItems.slice(0, 4).map((rel) => (
                      <a
                        key={rel.id}
                        href={rel.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-[11px] text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                      >
                        {rel.title || rel.url}
                      </a>
                    ))}
                  </div>
                )}
              </div>
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
