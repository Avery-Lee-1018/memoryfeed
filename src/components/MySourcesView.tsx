import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { SourceEntry, SourceLevel } from "@/types/source";

type Props = {
  sourceInput: string;
  sourceSubmitting: boolean;
  sourcesLoading: boolean;
  sources: SourceEntry[];
  onInputChange: (value: string) => void;
  onSubmitSources: () => void;
  onToggleActive: (source: SourceEntry) => void;
  onMoveLevel: (sourceId: number, level: LevelKey) => void | Promise<void>;
  onDeleteSource: (sourceId: number) => void;
};

type LevelKey = SourceLevel;

const LEVELS: { key: LevelKey; title: string; hint: string }[] = [
  { key: "core", title: "Core", hint: "자주 떠오른 출처" },
  { key: "focus", title: "Focus", hint: "가볍게 다시 보는 출처" },
  { key: "light", title: "Light", hint: "가끔 들르는 출처" },
];

const LEVEL_THEME: Record<LevelKey, { shell: string; badge: string; hint: string }> = {
  core: {
    shell: "bg-[#FFEDD7] border-[#FFEDD7]",
    badge: "bg-[#FF4802] text-white",
    hint: "자주 떠오른 출처",
  },
  focus: {
    shell: "bg-[#D3E1DB] border-[#D3E1DB]",
    badge: "bg-[#009953] text-white",
    hint: "가볍게 다시 보는 출처",
  },
  light: {
    shell: "bg-[#DFD6D5] border-[#DFD6D5]",
    badge: "bg-[#A3726D] text-white",
    hint: "가끔 들르는 출처",
  },
};

const STORAGE_KEY = "memoryfeed.sourceLevelOverrides.v1";

function formatRecentLabel(value?: string | null) {
  if (!value) return "업데이트 없음";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return "업데이트 없음";

  const yy = String(parsed.getFullYear()).slice(-2);
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd} 업데이트`;
}

function resolveSourceOpenUrl(source: SourceEntry) {
  if (source.type !== "rss") return source.url;
  try {
    const parsed = new URL(source.url);
    return `${parsed.protocol}//${parsed.hostname}/`;
  } catch {
    return source.url;
  }
}

function scoreSource(source: SourceEntry) {
  return source.exposureCount + source.memoCount * 2;
}

function inferLevel(source: SourceEntry): LevelKey {
  const score = scoreSource(source);
  if (score >= 8) return "core";
  if (score >= 3) return "focus";
  return "light";
}

function readLevelOverrides(): Record<number, LevelKey> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LevelKey>;
    const next: Record<number, LevelKey> = {};
    for (const [id, level] of Object.entries(parsed)) {
      if (level === "light" || level === "focus" || level === "core") {
        next[Number(id)] = level;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function getExtractionLabel(source: SourceEntry) {
  return source.extractionMode === "split" ? "개별 링크" : "통합 링크";
}

function getExtractionChipClass(source: SourceEntry) {
  return source.extractionMode === "split"
    ? "border-zinc-200 bg-zinc-100 text-zinc-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function getExtractionCases(source: SourceEntry) {
  const reason = source.extractionReason ?? "UNKNOWN";
  switch (reason) {
    case "NO_ITEMS":
      return "아직 수집된 아이템이 없어요. 사이트 구조/응답 상태를 먼저 점검해야 해요.";
    case "ROOT_ONLY":
      return "홈/피드 페이지 URL만 감지되고 개별 아티클 링크가 추출되지 않았어요.";
    case "ONE_SPLIT":
      return "개별 아티클은 감지되지만 1개뿐이라 안정적으로 분리 노출되기 어려워요.";
    case "BLOCKED_PATTERN":
      return "동적 렌더링/접근 제한/스크립트 의존 구조로 정적 크롤링에서 링크 추출이 제한돼요.";
    default:
      return source.extractionNote ?? "분리 노출 상태를 진단 중이에요.";
  }
}

export default function MySourcesView({
  sourceInput,
  sourceSubmitting,
  sourcesLoading,
  sources,
  onInputChange,
  onSubmitSources,
  onToggleActive,
  onMoveLevel,
  onDeleteSource,
}: Props) {
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<number, LevelKey>>({});
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverLevel, setDragOverLevel] = useState<LevelKey | null>(null);
  const [diagnoseOpenId, setDiagnoseOpenId] = useState<number | null>(null);
  const canSubmitSource = sourceInput.trim().length > 0 && !sourceSubmitting;

  useEffect(() => {
    setOverrides(readLevelOverrides());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides]);

  useEffect(() => {
    const validIds = new Set(sources.map((source) => source.id));
    setOverrides((prev) => {
      const next: Record<number, LevelKey> = {};
      let changed = false;
      for (const [idRaw, level] of Object.entries(prev)) {
        const id = Number(idRaw);
        if (validIds.has(id)) next[id] = level;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sources]);

  const filteredSources = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((source) => {
      return source.name.toLowerCase().includes(q) || source.url.toLowerCase().includes(q);
    });
  }, [sources, query]);

  const groupedSources = useMemo(() => {
    const groups: Record<LevelKey, SourceEntry[]> = { core: [], focus: [], light: [] };
    for (const source of filteredSources) {
      const level = overrides[source.id] ?? source.level ?? inferLevel(source);
      groups[level].push(source);
    }
    groups.core.sort((a, b) => b.id - a.id);
    groups.focus.sort((a, b) => b.id - a.id);
    groups.light.sort((a, b) => b.id - a.id);
    return groups;
  }, [filteredSources, overrides]);

  const moveSourceLevel = (sourceId: number, level: LevelKey) => {
    setOverrides((prev) => ({ ...prev, [sourceId]: level }));
  };

  const submitSearch = (e?: FormEvent) => {
    if (e) e.preventDefault();
    setQuery(draftQuery.trim());
  };
  const clearSearch = () => {
    setDraftQuery("");
    setQuery("");
  };

  return (
    <section className="space-y-3 sm:space-y-4">
      <Card className="rounded-2xl border-0 bg-white shadow-sm">
        <CardHeader className="pb-2 pt-4">
          <h2 className="text-base font-semibold tracking-tight">북마크 추가하기</h2>
        </CardHeader>
        <CardContent className="space-y-2 pb-4">
          <textarea
            value={sourceInput}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="추가할 링크를 한 번에 붙여넣어 주세요 (여러 줄 가능)"
            rows={3}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-xs text-zinc-800">
              <i className="ri-checkbox-circle-fill text-emerald-500" />
              공백/줄바꿈 기준으로 자동 분리 · 새로운 링크만 자동 등록
            </p>
            <button
              onClick={onSubmitSources}
              disabled={!canSubmitSource}
              className="ml-auto rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sourceSubmitting ? "추가 중..." : "한 번에 추가"}
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-5 px-1">
        <div className="flex items-center justify-between">
          <h3 className="ml-2 text-base font-semibold tracking-tight text-zinc-800">언젠가는 읽을 북마크 모음</h3>
          <div className="mr-2 flex items-center gap-2">
            <p className="text-sm text-zinc-700">총 {sources.length}개 북마크</p>
            <button
              type="button"
              onClick={() => setSearchOpen((prev) => !prev)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-300"
              aria-label="검색 펼치기"
              aria-expanded={searchOpen}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center">
                <i className="ri-search-line block text-[12px] leading-none" />
              </span>
            </button>
          </div>
        </div>
        {searchOpen && (
          <form onSubmit={submitSearch} className="relative">
            <input
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder="북마크 검색"
              className="w-full rounded-full border border-zinc-200 bg-white px-4 py-3 pr-11 text-sm text-foreground placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {(draftQuery.length > 0 || query.length > 0) && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                aria-label="검색어 지우기"
              >
                <i className="ri-close-line text-[12px] leading-none" />
              </button>
            )}
          </form>
        )}
      </div>

      {sourcesLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {LEVELS.map((level) => (
            <div key={`skeleton-${level.key}`} className={`rounded-2xl border p-4 ${LEVEL_THEME[level.key].shell}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="h-6 w-20 animate-pulse rounded-full bg-white/80" />
                <div className="h-4 w-8 animate-pulse rounded bg-white/70" />
              </div>
              <div className="space-y-3">
                {[0, 1].map((i) => (
                  <div key={i} className="rounded-2xl border border-zinc-200/80 bg-white p-4">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-3 h-6 w-24 animate-pulse rounded-full bg-zinc-200" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : sources.length === 0 ? (
        <div className="rounded-xl bg-white/70 px-4 py-8 text-center text-sm text-muted-foreground">
          아직 추가한 소스가 없어요.
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="rounded-xl bg-white/70 px-4 py-8 text-center text-sm text-muted-foreground">
          검색 결과가 없어요.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {LEVELS.map((level) => (
            <div
              key={level.key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverLevel(level.key);
              }}
              onDragLeave={() => setDragOverLevel((prev) => (prev === level.key ? null : prev))}
              onDrop={() => {
                if (draggingId != null) {
                  moveSourceLevel(draggingId, level.key);
                  void onMoveLevel(draggingId, level.key);
                }
                setDraggingId(null);
                setDragOverLevel(null);
              }}
              className={`rounded-2xl border p-4 transition-colors ${
                LEVEL_THEME[level.key].shell
              } ${
                dragOverLevel === level.key ? "ring-2 ring-zinc-300" : ""
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_THEME[level.key].badge}`}>
                    {level.title}
                  </p>
                  <p className="text-xs text-zinc-600">{LEVEL_THEME[level.key].hint}</p>
                </div>
                <p className="text-xs text-zinc-500">{groupedSources[level.key].length}개</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:gap-4">
                {groupedSources[level.key].map((source) => (
                  <Card
                    key={source.id}
                    draggable
                    onDragStart={() => setDraggingId(source.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverLevel(null);
                    }}
                    className={`cursor-grab rounded-2xl border border-zinc-200/80 shadow-sm transition-colors active:cursor-grabbing ${
                      source.is_active !== 1 && source.memoCount > 0
                        ? "bg-zinc-100/80 opacity-80"
                        : "bg-white/95"
                    }`}
                  >
                    <CardHeader className="pb-2 pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold tracking-tight text-zinc-900">{source.name}</h3>
                          {source.extractionMode !== "split" && (
                            <span
                              className="inline-flex h-4 w-4 items-center justify-center text-amber-600"
                              title="개별 콘텐츠가 노출되지 않는 항목"
                              aria-label="개별 콘텐츠가 노출되지 않는 항목"
                            >
                              <i className="ri-error-warning-line text-[13px]" />
                            </span>
                          )}
                        </div>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${getExtractionChipClass(source)}`}>
                          {getExtractionLabel(source)}
                        </span>
                      </div>
                      <a
                        href={resolveSourceOpenUrl(source)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 line-clamp-1 text-xs text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 hover:decoration-zinc-500"
                      >
                        {source.type === "rss" && <i className="ri-rss-line text-[11px] text-zinc-300" aria-hidden />}
                        {source.type === "rss" ? resolveSourceOpenUrl(source) : source.url}
                      </a>
                    </CardHeader>
                    <CardContent className="pb-4 pt-0">
                      <p className="text-xs text-zinc-700">
                        {source.exposureCount}번 떠오름 · {source.memoCount}개 메모 · {formatRecentLabel(source.lastActivityAt ?? source.lastExposedAt)}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <i className="ri-file-list-2-line text-zinc-400" />
                        콘텐츠 {source.splitItems ?? 0}개
                      </p>
                      {source.extractionMode !== "split" && (
                        <div className="mt-1">
                          <button
                            type="button"
                            onClick={() => setDiagnoseOpenId((prev) => (prev === source.id ? null : source.id))}
                            className="text-[11px] text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                          >
                            진단하기
                          </button>
                          {diagnoseOpenId === source.id && (
                            <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">
                              {getExtractionCases(source)}
                            </p>
                          )}
                        </div>
                      )}
                      {source.is_active !== 1 && source.memoCount > 0 && (
                        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-zinc-600">
                          <i className="ri-lock-line" />
                          메모가 남아 있어 잠시 잠겨 있어요
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onToggleActive(source)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            source.is_active === 1 ? "bg-zinc-800" : "bg-zinc-300"
                          }`}
                          aria-label={source.is_active === 1 ? "비활성화" : "활성화"}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                              source.is_active === 1 ? "translate-x-5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                        <button
                          onClick={() => onDeleteSource(source.id)}
                          className="inline-flex items-center justify-center rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                          aria-label="삭제"
                        >
                          <i className="ri-delete-bin-line text-base" />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
