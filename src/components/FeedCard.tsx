import { useState } from "react";
import { marked } from "marked";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

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

type Props = FeedItem & { index?: number };

marked.setOptions({ breaks: true });

export default function FeedCard({
  id,
  title,
  url,
  summary,
  thumbnail_url,
  note,
  sourceName,
  index = 0,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [memoValue, setMemoValue] = useState(note ?? "");
  const [savedMemo, setSavedMemo] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const thumbnail = thumbnail_url ?? FALLBACK_THUMBNAILS[index % 3];
  const hasMemo = savedMemo.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/notes/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: memoValue }),
    });
    setSavedMemo(memoValue);
    setSaving(false);
    setMemoEditing(false);
  };

  const handleMemoButtonClick = () => {
    if (memoOpen && memoEditing) {
      // Cancel editing — revert unsaved changes
      setMemoValue(savedMemo);
      setMemoEditing(false);
      if (!hasMemo) setMemoOpen(false);
    } else if (memoOpen) {
      setMemoOpen(false);
    } else {
      setMemoOpen(true);
      // If no saved memo, go directly to edit mode
      if (!hasMemo) setMemoEditing(true);
    }
  };

  return (
    <Card className="w-full overflow-hidden rounded-2xl border-0 shadow-sm">
      {/* Thumbnail */}
      <div className="h-[201px] w-full overflow-hidden">
        <img src={thumbnail} alt="" className="h-full w-full object-cover" />
      </div>

      {/* Header */}
      <CardHeader className="pb-2 pt-4">
        <p className="text-xs text-muted-foreground">{sourceName}</p>
        <h2 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight">
          {title}
        </h2>
      </CardHeader>

      {/* Highlight */}
      {summary && (
        <CardContent className="pb-0 pt-0">
          <p className={`text-sm text-muted-foreground/80 ${expanded ? "" : "line-clamp-4"}`}>
            {summary}
          </p>
          {!expanded && summary.length > 160 && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
            >
              더 보기
            </button>
          )}
        </CardContent>
      )}

      {/* Actions */}
      <CardContent className="flex items-center justify-between pb-4 pt-5">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <i className="ri-external-link-line" />
          원문 보기
        </a>
        <button
          onClick={handleMemoButtonClick}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            hasMemo
              ? "bg-blue-50 text-blue-600"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <i className={hasMemo ? "ri-pencil-fill" : "ri-pencil-line"} />
          메모
          {hasMemo && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
        </button>
      </CardContent>

      {/* Memo */}
      {memoOpen && (
        <CardContent className="pt-0 pb-4 flex flex-col gap-2">
          {memoEditing ? (
            <>
              <textarea
                className="w-full resize-none rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                rows={4}
                placeholder={"메모를 남겨보세요\n마크다운 지원: # 제목  **굵게**  - 목록"}
                value={memoValue}
                onChange={(e) => setMemoValue(e.target.value)}
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setMemoValue(savedMemo);
                    setMemoEditing(false);
                    if (!hasMemo) setMemoOpen(false);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || memoValue === savedMemo}
                  className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity disabled:opacity-40"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </>
          ) : (
            <div className="relative group">
              <div
                className="prose prose-sm max-w-none text-sm text-foreground/80 rounded-lg bg-muted/30 p-3"
                dangerouslySetInnerHTML={{ __html: marked.parse(savedMemo) as string }}
              />
              <button
                onClick={() => setMemoEditing(true)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground shadow-sm"
                aria-label="메모 수정"
              >
                <i className="ri-pencil-line text-xs" />
              </button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
