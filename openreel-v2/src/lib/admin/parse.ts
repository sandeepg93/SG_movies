import { YOUTUBE_ID } from "@/lib/media";

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Accepts a YouTube ID or any YouTube video link and returns the 11-character ID. */
export function extractYouTubeId(input: string): string {
  const s = input.trim();
  if (YOUTUBE_ID.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.hostname === "youtu.be") return url.pathname.slice(1, 12);
    const v = url.searchParams.get("v");
    if (v) return v;
    const m = /\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (m) return m[2];
  } catch {
    // not a URL
  }
  return s;
}

/** Accepts an Internet Archive identifier or any archive.org item link. */
export function extractArchiveId(input: string): string {
  const s = input.trim();
  try {
    const url = new URL(s);
    const m = /\/(details|embed|download)\/([^/?#]+)/.exec(url.pathname);
    if (m) return decodeURIComponent(m[2]);
  } catch {
    // not a URL
  }
  return s;
}

export interface YouTubeTarget {
  handle?: string;
  channel?: string;
  playlist?: string;
  video?: string;
}

/** Understands @handles, channel IDs, playlist IDs and channel / playlist / video links. */
export function parseYouTubeTarget(input: string): YouTubeTarget {
  const s = input.trim();
  if (!s) return {};
  if (s.startsWith("@")) return { handle: s };
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { channel: s };
  if (/^(PL|UU|OL|FL)[A-Za-z0-9_-]{10,}$/.test(s)) return { playlist: s };
  try {
    const url = new URL(s);
    const list = url.searchParams.get("list");
    if (list) return { playlist: list };
    const handle = /^\/(@[^/]+)/.exec(url.pathname);
    if (handle) return { handle: decodeURIComponent(handle[1]) };
    const channel = /^\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(url.pathname);
    if (channel) return { channel: channel[1] };
    const video = extractYouTubeId(s);
    if (YOUTUBE_ID.test(video)) return { video };
    return {};
  } catch {
    return /^[A-Za-z0-9._-]+$/.test(s) ? { handle: "@" + s } : {};
  }
}
