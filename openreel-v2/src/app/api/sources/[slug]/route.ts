import { NextResponse } from "next/server";
import { getMovieBySlug } from "@/lib/catalog";
import { pickPlaybackItem } from "@/lib/playback-item";
import { archiveCaptionTracks, archiveVideoSources, getArchiveFiles } from "@/lib/archive";
import { isAllowedDirectUrl, isPlayable } from "@/lib/media";
import type { SourcesResponse, VideoSource } from "@/types/playback";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const episode = new URL(request.url).searchParams.get("episode");
  const movie = getMovieBySlug(slug);
  const item = movie ? pickPlaybackItem(movie, episode) : null;
  if (!movie || !item || !isPlayable(item)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: SourcesResponse = { sources: [], captions: [] };

  if (item.playbackType === "archive" && item.playbackId) {
    const files = await getArchiveFiles(item.playbackId);
    body = {
      sources: archiveVideoSources(item.playbackId, files),
      captions: archiveCaptionTracks(files, slug, episode),
    };
  } else if (item.playbackType === "direct_video") {
    let sources: VideoSource[] = [];
    if (item.videoSources && item.videoSources.length > 0) {
      sources = item.videoSources
        .filter((s) => isAllowedDirectUrl(s.url))
        .map((s) => {
          const source: VideoSource = { label: s.label, url: s.url, type: /\.webm(\?|$)/i.test(s.url) ? "video/webm" : "video/mp4" };
          if (s.height) source.height = s.height;
          return source;
        });
      sources.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    } else if (item.playbackUrl) {
      sources = [{ label: "Default", url: item.playbackUrl }];
    }
    body = { sources, captions: [] };
  }

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" },
  });
}
