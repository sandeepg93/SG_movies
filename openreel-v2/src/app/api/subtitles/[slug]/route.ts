import { getMovieBySlug } from "@/lib/catalog";
import { pickPlaybackItem } from "@/lib/playback-item";
import { archiveDownloadUrl, getArchiveFiles, toWebVtt } from "@/lib/archive";

type Context = { params: Promise<{ slug: string }> };

const MAX_BYTES = 3000000;

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? "";
  const episode = url.searchParams.get("episode");
  const movie = getMovieBySlug(slug);
  const item = movie ? pickPlaybackItem(movie, episode) : null;

  if (!movie || !item || item.playbackType !== "archive" || !item.playbackId || !/\.(srt|vtt)$/i.test(file)) {
    return new Response("Not found", { status: 404 });
  }

  // Only serve subtitle files that really belong to this item.
  const files = await getArchiveFiles(item.playbackId);
  if (!files.some((f) => f.name === file)) return new Response("Not found", { status: 404 });

  const res = await fetch(archiveDownloadUrl(item.playbackId, file), { next: { revalidate: 86400 } });
  if (!res.ok) return new Response("Subtitles unavailable", { status: 502 });
  const text = await res.text();
  if (text.length > MAX_BYTES) return new Response("Subtitles too large", { status: 413 });

  return new Response(toWebVtt(text), {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
