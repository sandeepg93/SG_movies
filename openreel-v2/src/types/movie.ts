export type RightsStatus = "pending_review" | "approved" | "rejected";
export type PlaybackType = "youtube" | "archive" | "direct_video";
export type Industry = "hollywood" | "bollywood" | "marathi" | "tollywood";
export type ContentType = "movie" | "show";
export type RightsBasis =
  | "public_domain"
  | "creative_commons"
  | "written_permission"
  | "license_agreement"
  | "platform_embed";

/** One quality version of a directly hosted video. */
export interface VideoSourceInput {
  label: string;
  url: string;
  height?: number;
}

export interface PlaybackFields {
  playbackType: PlaybackType;
  /** YouTube video ID or Internet Archive identifier. */
  playbackId?: string;
  /** Direct video file URL (direct_video only). */
  playbackUrl?: string;
  /** direct_video only: the same video in several qualities. */
  videoSources?: VideoSourceInput[];
  thumbnailUrl?: string | null;
}

export interface Episode extends PlaybackFields {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  runtimeMinutes?: number;
  description?: string;
}

export interface Movie extends PlaybackFields {
  id: string;
  slug: string;
  title: string;
  alternateTitles?: string[];
  description: string;
  director?: string;
  cast?: string[];
  industry: Industry;
  /** "movie" (default) or "show" (uses episodes). */
  contentType?: ContentType;
  episodes?: Episode[];
  releaseYear?: number;
  /** "YYYY-MM" or "YYYY-MM-DD"; enables month-wise browsing. */
  releaseDate?: string;
  languages: string[];
  genres: string[];
  runtimeMinutes?: number;
  sourcePageUrl: string;
  /** Views / downloads, filled by scripts/refresh-popularity.mjs. Drives "Trending". */
  popularity?: number;
  /** Pin to the top of Trending. */
  trending?: boolean;
  rightsBasis: RightsBasis;
  licenseUrl?: string | null;
  rightsNotes?: string;
  attribution: string;
  territories: string[];
  commercialUseAllowed: boolean;
  rightsStatus: RightsStatus;
  rightsReviewedAt?: string;
  rightsReviewer?: string;
  featured?: boolean;
}
