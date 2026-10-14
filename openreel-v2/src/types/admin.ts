import type { ContentType, Industry } from "@/types/movie";

/** A catalog entry as stored on disk (may be incomplete or invalid). */
export type RawRecord = Record<string, unknown>;

export type SourceKind = "youtube" | "archive";

export interface ImportSource {
  id: string;
  label: string;
  kind: SourceKind;
  industry: Industry;
  contentType: ContentType;
  /** YouTube: @handle, channel ID (UC…), playlist ID (PL…) or URL. Archive: search query. */
  target: string;
  /** New titles from a trusted source are published automatically. */
  trusted: boolean;
  territories: string[];
  minMinutes?: number;
  maxPerSync?: number;
  lastSyncAt?: string;
  lastResult?: string;
}

export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: string[];
  values?: Record<string, string>;
  version?: number;
}
