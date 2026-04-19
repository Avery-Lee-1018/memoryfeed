import type { SourceEntry } from "@/types/source";

export type SourceBulkResult = {
  added?: number;
  registeredCount?: number;
  failed?: number;
  invalidCount?: number;
  duplicateCount?: number;
  sourceIds?: number[];
  addedUrls?: string[];
  duplicateUrls?: string[];
  failedUrls?: string[];
  invalidTokens?: string[];
  error?: string;
};

type ToastTone = "success" | "warning" | "error";

export type SourceResultToast = {
  tone: ToastTone;
  title: string;
  description?: string;
  retryUrls?: string[];
};

export function parseSourceInput(input: string) {
  const tokens = input
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const deduped = new Set<string>();
  for (const token of tokens) {
    const normalized = normalizeSourceToken(token);
    if (normalized) deduped.add(normalized);
  }

  return {
    totalTokens: tokens.length,
    urls: [...deduped],
  };
}

function normalizeSourceToken(input: string) {
  const sanitized = input.trim().replace(/[),.;]+$/g, "");
  if (!sanitized) return null;
  const withScheme = /^[a-z]+:\/\//i.test(sanitized) ? sanitized : `https://${sanitized}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeSourceEntry(raw: Record<string, unknown>): SourceEntry {
  const levelRaw = typeof raw.level === "string" ? raw.level : null;
  const level = levelRaw === "core" || levelRaw === "focus" || levelRaw === "light"
    ? levelRaw
    : undefined;

  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? ""),
    url: String(raw.url ?? ""),
    type: raw.type === "rss" ? "rss" : "blog",
    level,
    is_active: Number(raw.is_active ?? 0),
    extractionMode: raw.extractionMode === "split" ? "split" : "single",
    extractionReason: typeof raw.extractionReason === "string"
      ? (raw.extractionReason as SourceEntry["extractionReason"])
      : "UNKNOWN",
    extractionNote: typeof raw.extractionNote === "string" ? raw.extractionNote : undefined,
    totalItems: Number(raw.totalItems ?? 0),
    splitItems: Number(raw.splitItems ?? 0),
    rootItems: Number(raw.rootItems ?? 0),
    exposureCount: Number(raw.exposureCount ?? 0),
    memoCount: Number(raw.memoCount ?? 0),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    lastExposedAt: typeof raw.lastExposedAt === "string" ? raw.lastExposedAt : null,
    lastActivityAt: typeof raw.lastActivityAt === "string" ? raw.lastActivityAt : null,
    lastRefreshedAt: typeof raw.lastRefreshedAt === "string" ? raw.lastRefreshedAt : null,
  };
}

export function buildSourceResultToast(result: SourceBulkResult): SourceResultToast {
  const added = result.added ?? 0;
  const duplicateCount = result.duplicateCount ?? 0;
  const invalidCount = result.invalidCount ?? 0;
  const failedUrls = result.failedUrls ?? [];
  const failedCount = invalidCount + failedUrls.length;
  const registeredCount = result.registeredCount ?? (added + duplicateCount);
  const reasonParts: string[] = [];

  if (duplicateCount > 0) reasonParts.push(`이미 등록 ${duplicateCount}개`);
  if (invalidCount > 0) reasonParts.push(`형식 오류 ${invalidCount}개`);
  if (failedUrls.length > 0) reasonParts.push(`처리 실패 ${failedUrls.length}개`);

  if (added > 0 && failedCount === 0) {
    return {
      tone: "success",
      title: `${added}개 등록됨`,
      description: duplicateCount > 0 ? `새로 ${added}개, 기존 ${duplicateCount}개` : undefined,
    };
  }

  if (added === 0 && duplicateCount > 0 && failedCount === 0) {
    return {
      tone: "warning",
      title: `이미 등록된 링크 ${duplicateCount}개`,
      description: "새로 추가된 링크는 없어요.",
    };
  }

  if (registeredCount === 0 && failedCount > 0) {
    return {
      tone: "error",
      title: `등록된 것 0개 · 안된 것 ${failedCount}개`,
      description: reasonParts.join(" · "),
      retryUrls: failedUrls.length > 0 ? failedUrls : undefined,
    };
  }

  return {
    tone: registeredCount > 0 ? "warning" : "error",
    title: registeredCount > 0
      ? `등록된 것 ${registeredCount}개 · 안된 것 ${failedCount}개`
      : `등록된 것 0개 · 안된 것 ${failedCount}개`,
    description: reasonParts.join(" · "),
    retryUrls: failedUrls.length > 0 ? failedUrls : undefined,
  };
}
