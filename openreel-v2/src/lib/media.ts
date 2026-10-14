import type { Movie, PlaybackFields } from "@/types/movie";
import { siteConfig } from "@/lib/config";

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedDirectUrl(value: string): boolean {
  if (!isHttpsUrl(value)) return false;
  const host = new URL(value).hostname;
  return siteConfig.allowedVideoHosts.some((allowed) => host === allowed || host.endsWith("." + allowed));
}

export function isPlayable(source: PlaybackFields): boolean {
  if (source.playbackType === "youtube") return typeof source.playbackId === "string" && YOUTUBE_ID.test(source.playbackId);
  if (source.playbackType === "archive") return typeof source.playbackId === "string" && ARCHIVE_ID.test(source.playbackId);
  if (source.playbackType === "direct_video") {
    if (Array.isArray(source.videoSources) && source.videoSources.length > 0) {
      return source.videoSources.every((s) => typeof s.url === "string" && isAllowedDirectUrl(s.url));
    }
    return typeof source.playbackUrl === "string" && isAllowedDirectUrl(source.playbackUrl);
  }
  return false;
}

/** A film is playable itself; a show is playable if at least one episode is. */
export function hasPlayableContent(movie: Movie): boolean {
  if (isPlayable(movie)) return true;
  return (movie.episodes ?? []).some((episode) => isPlayable(episode));
}

export function embedUrlFor(source: PlaybackFields, autoplay: boolean): string | null {
  if (!isPlayable(source) || !source.playbackId) return null;
  if (source.playbackType === "youtube") {
    const params = new URLSearchParams({ rel: "0", playsinline: "1", autoplay: autoplay ? "1" : "0" });
    return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(source.playbackId) + "?" + params.toString();
  }
  if (source.playbackType === "archive") {
    return "https://archive.org/embed/" + encodeURIComponent(source.playbackId) + (autoplay ? "?autoplay=1" : "");
  }
  return null;
}

export function thumbnailFor(source: PlaybackFields): string | null {
  if (source.thumbnailUrl && isHttpsUrl(source.thumbnailUrl)) return source.thumbnailUrl;
  if (source.playbackType === "youtube" && source.playbackId && YOUTUBE_ID.test(source.playbackId)) {
    return "https://i.ytimg.com/vi/" + source.playbackId + "/hqdefault.jpg";
  }
  if (source.playbackType === "archive" && source.playbackId && ARCHIVE_ID.test(source.playbackId)) {
    return "https://archive.org/services/img/" + encodeURIComponent(source.playbackId);
  }
  return null;
}
