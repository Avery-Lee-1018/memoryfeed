import { useState, useRef } from "react";
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

type SaveState = "idle" | "editing" | "saving" | "saved";

type Props = FeedItem & { index?: number };

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
  const [memoValue, setMemoValue] = useState(note ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnail = thumbnail_url ?? FALLBACK_THUMBNAILS[index % 3];

  const handleMemoChange = (value: string) => {
    setMemoValue(value);
    setSaveState("editing");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      await fetch(`/api/notes/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    }, 800);
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
        <div className="flex items-center gap-2">
          {saveState === "editing" && (
            <span className="text-xs text-muted-foreground/50">입력 중...</span>
          )}
          {saveState === "saving" && (
            <span className="text-xs text-muted-foreground/50">저장 중...</span>
          )}
          {saveState === "saved" && (
            <span className="text-xs text-foreground/40">저장됨 ✓</span>
          )}
          <button
            onClick={() => setMemoOpen((v) => !v)}
            className={`flex items-center gap-1 text-xs transition-colors ${
              memoOpen || memoValue ? "text-foreground/70" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <i className="ri-pencil-line" />
            메모
            {memoValue && <span className="h-1.5 w-1.5 rounded-full bg-foreground/30" />}
          </button>
        </div>
      </CardContent>

      {/* Memo */}
      {memoOpen && (
        <CardContent className="pt-0 pb-4">
          <textarea
            className="w-full resize-none rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            rows={4}
            placeholder={"메모를 남겨보세요\n마크다운 지원: # 제목  **굵게**  - 목록"}
            value={memoValue}
            onChange={(e) => handleMemoChange(e.target.value)}
          />
        </CardContent>
      )}
    </Card>
  );
}
