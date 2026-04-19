export type SourceLevel = "core" | "focus" | "light";

export type SourceEntry = {
  id: number;
  name: string;
  url: string;
  type: "rss" | "blog";
  level?: SourceLevel;
  is_active: number;
  extractionMode?: "split" | "single";
  extractionNote?: string;
  totalItems?: number;
  splitItems?: number;
  rootItems?: number;
  exposureCount: number;
  memoCount: number;
  lastExposedAt?: string | null;
  lastActivityAt?: string | null;
};
