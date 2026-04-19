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
  refreshingSourceIds: Set<number>;
  onRefreshSource: (sourceId: number) => void | Promise<void>;
  onOpenSourceMemos: (source: SourceEntry) => void;
  onboardingHosts: string[];
  onboardingSourceIds: number[];
  pendingSourceIds: number[];
};

type LevelKey = SourceLevel;
type SortKey = "recent" | "content" | "alpha";

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
const SORT_LABEL: Record<SortKey, string> = {
  recent: "최근 등록순",
  content: "콘텐츠 많은순",
  alpha: "가나다순",
};

function SourceFavicon({ url }: { url: string }) {
  const [visible, setVisible] = useState(true);
  let faviconUrl = "";
  try {
    const parsed = new URL(url);
    // Prefer high-resolution favicon endpoint.
    faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;
  } catch {
    return null;
  }
  if (!visible) return null;

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    // If the fetched icon is unexpectedly tiny, consider it unusable.
    if (img.naturalWidth < 20 || img.naturalHeight < 20) {
      setVisible(false);
      return;
    }
    // Hide near-white / nearly-transparent icons that become invisible on this UI.
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 20;
      canvas.height = 20;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 20, 20);
      const { data } = ctx.getImageData(0, 0, 20, 20);
      let nonTransparent = 0;
      let veryBright = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a > 18) {
          nonTransparent += 1;
          if (r > 242 && g > 242 && b > 242) veryBright += 1;
        }
      }
      if (nonTransparent === 0) {
        setVisible(false);
        return;
      }
      if (veryBright / nonTransparent > 0.82) {
        setVisible(false);
      }
    } catch {
      // If pixel inspection fails (CORS/canvas restrictions), keep the icon.
    }
  };

  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      onError={() => setVisible(false)}
      onLoad={handleLoad}
      referrerPolicy="no-referrer"
      className="h-4 w-4 shrink-0 rounded-full object-cover"
    />
  );
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
  refreshingSourceIds,
  onRefreshSource,
  onOpenSourceMemos,
  onboardingHosts,
  onboardingSourceIds,
  pendingSourceIds,
}: Props) {
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<number, LevelKey>>({});
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverLevel, setDragOverLevel] = useState<LevelKey | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
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
    const onboardingSet = new Set([...onboardingSourceIds, ...pendingSourceIds]);
    for (const source of filteredSources) {
      if (onboardingSet.has(source.id)) continue;
      const level = overrides[source.id] ?? source.level;
      if (!level) continue;
      groups[level].push(source);
    }
    const getCreatedAtMs = (source: SourceEntry) => {
      if (!source.createdAt) return 0;
      const ms = new Date(source.createdAt).getTime();
      return Number.isFinite(ms) ? ms : 0;
    };
    const sorter = (a: SourceEntry, b: SourceEntry) => {
      if (sortKey === "alpha") {
        const byName = a.name.localeCompare(b.name, "ko");
        return byName !== 0 ? byName : b.id - a.id;
      }
      if (sortKey === "content") {
        const byContent = (b.splitItems ?? 0) - (a.splitItems ?? 0);
        if (byContent !== 0) return byContent;
        const byTotal = (b.totalItems ?? 0) - (a.totalItems ?? 0);
        if (byTotal !== 0) return byTotal;
        return b.id - a.id;
      }
      const byCreatedAt = getCreatedAtMs(b) - getCreatedAtMs(a);
      if (byCreatedAt !== 0) return byCreatedAt;
      return b.id - a.id;
    };
    groups.core.sort(sorter);
    groups.focus.sort(sorter);
    groups.light.sort(sorter);
    return groups;
  }, [filteredSources, overrides, sortKey, onboardingSourceIds, pendingSourceIds]);

  const onboardingSources = useMemo(() => {
    const idSet = new Set([...onboardingSourceIds, ...pendingSourceIds]);
    const q = query.trim().toLowerCase();
    const rows = sources.filter((source) => idSet.has(source.id));
    if (!q) return rows;
    return rows.filter((source) => source.name.toLowerCase().includes(q) || source.url.toLowerCase().includes(q));
  }, [sources, onboardingSourceIds, pendingSourceIds, query]);

  const unclassifiedSources = useMemo(() => {
    const onboardingSet = new Set([...onboardingSourceIds, ...pendingSourceIds]);
    return filteredSources.filter((source) => {
      if (onboardingSet.has(source.id)) return false;
      const level = overrides[source.id] ?? source.level;
      return !level;
    });
  }, [filteredSources, overrides, onboardingSourceIds, pendingSourceIds]);

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
    <section className="space-y-0">
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

      <div className="h-10 sm:h-12" />

      <div className={`space-y-5 px-1 ${searchOpen ? "pb-5 sm:pb-6" : ""}`}>
        <div className="mb-3 flex items-center justify-between sm:mb-4">
          <h3 className="ml-2 text-lg font-bold tracking-tight text-zinc-800">언젠가는 읽을 북마크 모음</h3>
          <div className="mr-2 flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setSortDropdownOpen((prev) => !prev)}
                className="flex h-7 items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 text-[11px] text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-ring"
                aria-haspopup="listbox"
                aria-expanded={sortDropdownOpen}
              >
                <span>{SORT_LABEL[sortKey]}</span>
                <i className="ri-arrow-down-s-line text-xs text-zinc-500" />
              </button>
              {sortDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setSortDropdownOpen(false)}
                  />
                  <ul
                    role="listbox"
                    className="absolute right-0 top-full z-20 mt-1 min-w-[112px] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
                  >
                    {(["recent", "content", "alpha"] as SortKey[]).map((key) => (
                      <li
                        key={key}
                        role="option"
                        aria-selected={sortKey === key}
                        onClick={() => { setSortKey(key); setSortDropdownOpen(false); }}
                        className={`cursor-pointer px-3 py-1.5 text-[11px] transition-colors ${
                          sortKey === key
                            ? "bg-zinc-100 font-medium text-zinc-900"
                            : "text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {SORT_LABEL[key]}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
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

      {(onboardingHosts.length > 0 || onboardingSources.length > 0 || unclassifiedSources.length > 0) && (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-white">
                미분류
              </span>
              <p className="text-xs text-zinc-600">
                {onboardingHosts.length + onboardingSources.length > 0
                  ? "추가된 링크가 순서대로 등록되는 중이에요"
                  : "Core / Focus / Light로 드래그해서 분류하세요"}
              </p>
            </div>
            <p className="text-xs text-zinc-500">
              {onboardingHosts.length + onboardingSources.length + unclassifiedSources.length}개
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {onboardingHosts.map((host, idx) => (
              <div key={`loading-${host}-${idx}`} className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="h-4 w-28 animate-pulse rounded bg-zinc-200" />
                <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-zinc-200" />
                <div className="mt-3 h-7 w-full animate-pulse rounded-lg bg-zinc-100" />
              </div>
            ))}
            {onboardingSources.map((source) => (
              <div key={`ready-${source.id}`} className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="truncate text-sm font-semibold text-zinc-900">{source.name}</p>
                <p className="mt-1 truncate text-xs text-zinc-500">{source.url}</p>
                <p className="mt-2 text-[11px] text-emerald-600">등록 완료</p>
              </div>
            ))}
            {unclassifiedSources.map((source) =>
              refreshingSourceIds.has(source.id) ? (
                <Card key={source.id} className="rounded-2xl border border-zinc-200/80 bg-white/95 shadow-sm">
                  <CardHeader className="pb-2 pt-4">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-zinc-200" />
                  </CardHeader>
                  <CardContent className="pb-4 pt-0">
                    <div className="h-3 w-11/12 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-4 flex items-center justify-between">
                      <div className="h-6 w-28 animate-pulse rounded-full bg-zinc-200" />
                      <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-200" />
                    </div>
                  </CardContent>
                </Card>
              ) : (
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
                        <SourceFavicon url={source.url} />
                        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-zinc-900">
                          {source.name}
                        </h3>
                        {source.extractionMode !== "split" && (
                          <span
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-amber-600"
                            title="개별 콘텐츠가 노출되지 않는 항목"
                            aria-label="개별 콘텐츠가 노출되지 않는 항목"
                          >
                            <i className="ri-error-warning-line text-[13px]" />
                          </span>
                        )}
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${getExtractionChipClass(source)}`}
                      >
                        {getExtractionLabel(source)}
                      </span>
                    </div>
                    <a
                      href={resolveSourceOpenUrl(source)}
                      target="_blank"
                      rel="noopener noreferrer"
                      draggable={false}
                      className="mt-0.5 flex w-full items-start gap-1 text-xs text-zinc-600 underline decoration-zinc-300 underline-offset-2 break-all hover:text-zinc-900 hover:decoration-zinc-500"
                    >
                      {source.type === "rss" && <i className="ri-rss-line mt-0.5 shrink-0 text-[11px] text-zinc-300" aria-hidden />}
                      {source.type === "rss" ? resolveSourceOpenUrl(source) : source.url}
                    </a>
                  </CardHeader>
                  <CardContent className="pb-4 pt-0">
                    <p className="text-xs text-zinc-700">
                      <button
                        type="button"
                        onClick={() => onOpenSourceMemos(source)}
                        className="inline-flex cursor-pointer items-center gap-0 text-zinc-700 underline-offset-2 transition-colors hover:text-zinc-900 hover:underline"
                        title="같은 소스 피드 보기"
                        aria-label="같은 소스 피드 보기"
                      >
                        <span>{source.exposureCount}번 떠오름</span>
                        <i className="ri-arrow-right-up-line text-[12px]" />
                      </button>
                      {" · "}
                      {source.memoCount}개 메모
                    </p>
                    {source.extractionMode === "split" && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <i className="ri-file-list-2-line text-zinc-400" />
                        콘텐츠 {source.splitItems ?? 0}개
                      </p>
                    )}
                    {source.is_active !== 1 && source.memoCount > 0 && (
                      <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-zinc-600">
                        <i className="ri-lock-line" />
                        메모가 남아 있어 잠시 잠겨 있어요
                      </p>
                    )}
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="flex flex-col items-start gap-1">
                        <button
                          type="button"
                          onClick={() => void onRefreshSource(source.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700 transition-colors hover:bg-zinc-50"
                        >
                          <i className="ri-refresh-line text-[12px]" />
                          업데이트
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onToggleActive(source)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                            source.is_active === 1 ? "bg-zinc-800" : "bg-zinc-300"
                          }`}
                          aria-label={source.is_active === 1 ? "비활성화" : "활성화"}
                        >
                          <span
                            className={`block h-5 w-5 transform rounded-full bg-white transition-transform ${
                              source.is_active === 1 ? "translate-x-5" : "translate-x-0"
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
                    </div>
                  </CardContent>
                </Card>
              )
            )}
          </div>
        </div>
      )}

      {(onboardingHosts.length > 0 || onboardingSources.length > 0 || unclassifiedSources.length > 0) && (
        <div className="h-8" />
      )}

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
                <div className="flex items-center gap-2">
                  <p className="text-xs text-zinc-500">{groupedSources[level.key].length}개</p>
                </div>
              </div>
              <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${groupedSources[level.key].length === 0 ? "min-h-[72px]" : ""}`}>
                {groupedSources[level.key].length === 0 && (
                  <div className={`flex items-center justify-center rounded-xl border-2 border-dashed py-6 text-xs transition-colors ${
                    dragOverLevel === level.key
                      ? "border-zinc-400 bg-white/60 text-zinc-600"
                      : draggingId != null
                      ? "border-zinc-300 text-zinc-400"
                      : "border-transparent text-transparent"
                  }`}>
                    여기에 드래그
                  </div>
                )}
                {groupedSources[level.key].map((source) => (
                  refreshingSourceIds.has(source.id) ? (
                    <Card key={source.id} className="rounded-2xl border border-zinc-200/80 bg-white/95 shadow-sm">
                      <CardHeader className="pb-2 pt-4">
                        <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200" />
                        <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-zinc-200" />
                      </CardHeader>
                      <CardContent className="pb-4 pt-0">
                        <div className="h-3 w-11/12 animate-pulse rounded bg-zinc-200" />
                        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-zinc-200" />
                        <div className="mt-4 flex items-center justify-between">
                          <div className="h-6 w-28 animate-pulse rounded-full bg-zinc-200" />
                          <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-200" />
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
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
                            <SourceFavicon url={source.url} />
                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-zinc-900">
                              {source.name}
                            </h3>
                            {source.extractionMode !== "split" && (
                              <span
                                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-amber-600"
                                title="개별 콘텐츠가 노출되지 않는 항목"
                                aria-label="개별 콘텐츠가 노출되지 않는 항목"
                              >
                                <i className="ri-error-warning-line text-[13px]" />
                              </span>
                            )}
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${getExtractionChipClass(source)}`}
                          >
                            {getExtractionLabel(source)}
                          </span>
                        </div>
                        <a
                          href={resolveSourceOpenUrl(source)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 flex w-full items-start gap-1 text-xs text-zinc-600 underline decoration-zinc-300 underline-offset-2 break-all hover:text-zinc-900 hover:decoration-zinc-500"
                        >
                          {source.type === "rss" && <i className="ri-rss-line mt-0.5 shrink-0 text-[11px] text-zinc-300" aria-hidden />}
                          {source.type === "rss" ? resolveSourceOpenUrl(source) : source.url}
                        </a>
                      </CardHeader>
                      <CardContent className="pb-4 pt-0">
                        <p className="text-xs text-zinc-700">
                          <button
                            type="button"
                            onClick={() => onOpenSourceMemos(source)}
                            className="inline-flex cursor-pointer items-center gap-0 text-zinc-700 underline-offset-2 transition-colors hover:text-zinc-900 hover:underline"
                            title="같은 소스 피드 보기"
                            aria-label="같은 소스 피드 보기"
                          >
                            <span>{source.exposureCount}번 떠오름</span>
                            <i className="ri-arrow-right-up-line text-[12px]" />
                          </button>
                          {" · "}
                          {source.memoCount}개 메모
                        </p>
                        {source.extractionMode === "split" && (
                          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500">
                            <i className="ri-file-list-2-line text-zinc-400" />
                            콘텐츠 {source.splitItems ?? 0}개
                          </p>
                        )}
                        {source.is_active !== 1 && source.memoCount > 0 && (
                          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-zinc-600">
                            <i className="ri-lock-line" />
                            메모가 남아 있어 잠시 잠겨 있어요
                          </p>
                        )}
                        <div className="mt-3 flex items-end justify-between gap-2">
                          <div className="flex flex-col items-start gap-1">
                            <button
                              type="button"
                              onClick={() => void onRefreshSource(source.id)}
                              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700 transition-colors hover:bg-zinc-50"
                            >
                              <i className="ri-refresh-line text-[12px]" />
                              업데이트
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onToggleActive(source)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                                source.is_active === 1 ? "bg-zinc-800" : "bg-zinc-300"
                              }`}
                              aria-label={source.is_active === 1 ? "비활성화" : "활성화"}
                            >
                              <span
                                className={`block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                  source.is_active === 1 ? "translate-x-5" : "translate-x-0"
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
                        </div>
                      </CardContent>
                    </Card>
                  )
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
