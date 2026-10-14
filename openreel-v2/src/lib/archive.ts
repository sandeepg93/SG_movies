import type { CaptionTrack, VideoSource } from "@/types/playback";

export interface ArchiveFile {
  name?: string;
  format?: string;
  size?: string;
  height?: string;
  width?: string;
  length?: string;
  source?: string;
}

/** File list of an Internet Archive item (cached for a day). */
export async function getArchiveFiles(identifier: string): Promise<ArchiveFile[]> {
  try {
    const res = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier), {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: unknown };
    return Array.isArray(data.files) ? (data.files as ArchiveFile[]) : [];
  } catch {
    return [];
  }
}

export function archiveDownloadUrl(identifier: string, name: string): string {
  return "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + name.split("/").map(encodeURIComponent).join("/");
}

function parseLength(value?: string): number {
  if (!value) return 0;
  if (value.includes(":")) {
    return value.split(":").reduce((total, part) => total * 60 + (Number(part) || 0), 0);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function estimateHeight(bitrateKbps: number): number {
  if (bitrateKbps >= 4000) return 1080;
  if (bitrateKbps >= 2000) return 720;
  if (bitrateKbps >= 900) return 480;
  return 360;
}

/** Every browser-playable quality version of an Archive item, best first. */
export function archiveVideoSources(identifier: string, files: ArchiveFile[]): VideoSource[] {
  const candidates = files
    .filter((f): f is ArchiveFile & { name: string } => typeof f.name === "string" && /\.(mp4|m4v|webm)$/i.test(f.name) && !/thumb/i.test(f.name))
    .map((f) => {
      const length = parseLength(f.length);
      const size = Number(f.size) || 0;
      const bitrate = length > 0 && size > 0 ? Math.round((size * 8) / length / 1000) : 0;
      const realHeight = Number(f.height) || 0;
      const height = realHeight > 0 ? realHeight : bitrate > 0 ? estimateHeight(bitrate) : 0;
      const label = height > 0 ? height + "p" : /512kb/i.test(f.name) ? "Low" : "Standard";
      const type = /\.webm$/i.test(f.name) ? "video/webm" : "video/mp4";
      const source: VideoSource = { label, url: archiveDownloadUrl(identifier, f.name), type };
      if (height > 0) source.height = height;
      if (bitrate > 0) source.bitrate = bitrate;
      return source;
    });

  candidates.sort((a, b) => {
    const byHeight = (b.height ?? 0) - (a.height ?? 0);
    if (byHeight !== 0) return byHeight;
    if (a.type !== b.type) return a.type === "video/mp4" ? -1 : 1;
    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  });

  const seen = new Set<string>();
  const out: VideoSource[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.label)) continue;
    seen.add(candidate.label);
    out.push(candidate);
    if (out.length >= 6) break;
  }
  return out;
}

const LANGUAGE_HINTS: [RegExp, string, string][] = [
  [/(^|[._\-\s])(en|eng|english)([._\-\s]|$)/i, "en", "English"],
  [/hindi|(^|[._\-\s])(hi|hin)([._\-\s]|$)/i, "hi", "Hindi"],
  [/marathi|(^|[._\-\s])(mr|mar)([._\-\s]|$)/i, "mr", "Marathi"],
  [/telugu|(^|[._\-\s])(te|tel)([._\-\s]|$)/i, "te", "Telugu"],
  [/spanish|espanol|(^|[._\-\s])(es|spa)([._\-\s]|$)/i, "es", "Spanish"],
  [/french|francais|(^|[._\-\s])(fr|fre|fra)([._\-\s]|$)/i, "fr", "French"],
  [/german|deutsch|(^|[._\-\s])(de|ger|deu)([._\-\s]|$)/i, "de", "German"],
];

export function archiveCaptionTracks(files: ArchiveFile[], slug: string, episode: string | null): CaptionTrack[] {
  return files
    .filter((f): f is ArchiveFile & { name: string } => typeof f.name === "string" && /\.(srt|vtt)$/i.test(f.name))
    .slice(0, 8)
    .map((f, i) => {
      const hint = LANGUAGE_HINTS.find(([pattern]) => pattern.test(f.name));
      const params = new URLSearchParams({ file: f.name });
      if (episode !== null && episode !== "") params.set("episode", episode);
      return {
        label: hint ? hint[2] : "Subtitles " + (i + 1),
        lang: hint ? hint[1] : "und",
        src: "/api/subtitles/" + encodeURIComponent(slug) + "?" + params.toString(),
      };
    });
}

/** Converts SRT to WebVTT (WebVTT input is returned unchanged). */
export function toWebVtt(text: string): string {
  const body = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (body.trimStart().startsWith("WEBVTT")) return body;
  return "WEBVTT\n\n" + body.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}
