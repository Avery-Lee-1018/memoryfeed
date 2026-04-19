export type SourceLevel = "core" | "focus" | "light";

export type SourceEntry = {
  id: number;
  name: string;
  url: string;
  type: "rss" | "blog";
  level?: SourceLevel;
  is_active: number;
  extractionMode?: "split" | "single";
  extractionReason?: "NO_ITEMS" | "ROOT_ONLY" | "ONE_SPLIT" | "BLOCKED_PATTERN" | "UNKNOWN";
  extractionNote?: string;
  totalItems?: number;
  splitItems?: number;
  rootItems?: number;
  exposureCount: number;
  memoCount: number;
  lastExposedAt?: string | null;
  lastActivityAt?: string | null;
};
