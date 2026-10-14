"use client";

import { useEffect, useMemo, useState } from "react";
import type { Episode, Movie, PlaybackFields } from "@/types/movie";
import type { SourcesResponse } from "@/types/playback";
import Thumb from "@/components/Thumb";
import Icon from "@/components/Icons";
import CustomVideoPlayer from "@/components/CustomVideoPlayer";
import { embedUrlFor, isPlayable, thumbnailFor } from "@/lib/media";
import { formatRuntime } from "@/lib/format";
import { reportMailto } from "@/lib/contact";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: SourcesResponse }
  | { status: "failed" };

function Unavailable({ movie }: { movie: Movie }) {
  return (
    <div className="unavailable" role="status">
      <p><strong>This title isn&apos;t ready to play yet.</strong></p>
      <p className="muted small">
        Its video source hasn&apos;t been added yet. <a href={reportMailto("broken_playback", movie)}>Report a problem</a>
      </p>
    </div>
  );
}

function EmbedFrame({ src, title, movie, isYouTube }: { src: string; title: string; movie: Movie; isYouTube: boolean }) {
  return (
    <div>
      <div className="player-frame">
        <iframe
          src={src}
          title={"Player: " + title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className="player-help">
        {isYouTube
          ? "Quality, subtitles and speed are in the ⚙ menu inside the YouTube player. "
          : "Using the source's own player. "}
        Not playing? <a href={reportMailto("broken_playback", movie)}>Report it</a>.
      </p>
    </div>
  );
}

interface SourcePlayerProps {
  movie: Movie;
  item: PlaybackFields;
  episodeIndex: number | null;
  title: string;
  poster: string | null;
  autoPlay: boolean;
  onEnded?: () => void;
}

function SourcePlayer({ movie, item, episodeIndex, title, poster, autoPlay, onEnded }: SourcePlayerProps) {
  const [started, setStarted] = useState(autoPlay);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const playable = isPlayable(item);
  const needsSources = playable && (item.playbackType === "archive" || item.playbackType === "direct_video");

  useEffect(() => {
    if (!started || !needsSources) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    const url = "/api/sources/" + encodeURIComponent(movie.slug) + (episodeIndex !== null ? "?episode=" + episodeIndex : "");
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json() as Promise<SourcesResponse>;
      })
      .then((data) => setLoad({ status: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Could not load video sources", error);
        setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [started, needsSources, movie.slug, episodeIndex]);

  if (!playable) return <Unavailable movie={movie} />;

  if (!started) {
    return (
      <button type="button" className="player-frame player-facade" onClick={() => setStarted(true)} aria-label={"Play " + title}>
        <Thumb src={poster} alt={title} eager />
        <span className="facade-play" aria-hidden="true">
          <Icon name="play" size={40} />
        </span>
      </button>
    );
  }

  if (item.playbackType === "youtube") {
    const src = embedUrlFor(item, true);
    return src ? <EmbedFrame src={src} title={title} movie={movie} isYouTube /> : <Unavailable movie={movie} />;
  }

  if (load.status === "ready" && load.data.sources.length > 0) {
    return (
      <CustomVideoPlayer
        sources={load.data.sources}
        captions={load.data.captions}
        poster={poster}
        title={title}
        autoPlay
        storageKey={"openreel:position:" + movie.id + (episodeIndex !== null ? ":" + episodeIndex : "")}
        onEnded={onEnded}
      />
    );
  }

  if (load.status === "ready" || load.status === "failed") {
    // No playable files found: fall back to the Archive's own player.
    if (item.playbackType === "archive") {
      const src = embedUrlFor(item, true);
      if (src) return <EmbedFrame src={src} title={title} movie={movie} isYouTube={false} />;
    }
    return <Unavailable movie={movie} />;
  }

  return (
    <div className="player-frame player-loading" role="status" aria-label="Loading video">
      <Thumb src={poster} alt={title} eager />
      <span className="cvp-spinner" aria-hidden="true" />
    </div>
  );
}

function EpisodeList({
  movie,
  episodes,
  activeIndex,
  onSelect,
}: {
  movie: Movie;
  episodes: Episode[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const seasons = useMemo(
    () => Array.from(new Set(episodes.map((ep) => ep.season ?? 1))).sort((a, b) => a - b),
    [episodes],
  );
  const [season, setSeason] = useState<number>(episodes[activeIndex]?.season ?? seasons[0] ?? 1);
  const visible = episodes.map((ep, index) => ({ ep, index })).filter(({ ep }) => (ep.season ?? 1) === season);

  return (
    <section className="episodes" aria-label="Episodes">
      <div className="episodes-head">
        <h3>
          Episodes <span className="muted small">({episodes.length})</span>
        </h3>
        {seasons.length > 1 && (
          <label>
            <span className="sr-only">Season</span>
            <select value={season} onChange={(event) => setSeason(Number(event.target.value))}>
              {seasons.map((s) => (
                <option key={s} value={s}>{"Season " + s}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ol className="episode-list">
        {visible.map(({ ep, index }) => (
          <li key={ep.id}>
            <button
              type="button"
              className={"episode" + (index === activeIndex ? " is-active" : "")}
              onClick={() => onSelect(index)}
              aria-current={index === activeIndex ? "true" : undefined}
            >
              <span className="episode-thumb">
                <Thumb src={thumbnailFor(ep) ?? thumbnailFor(movie)} alt={ep.title} />
                {index === activeIndex && <span className="now-playing">Now playing</span>}
              </span>
              <span className="episode-text">
                <span className="episode-num">{"S" + (ep.season ?? 1) + " · E" + (ep.episode ?? index + 1)}</span>
                <span className="episode-title">{ep.title}</span>
                {ep.runtimeMinutes !== undefined && <span className="episode-meta">{formatRuntime(ep.runtimeMinutes)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function VideoPlayer({ movie, autoPlay = false }: { movie: Movie; autoPlay?: boolean }) {
  const episodes = movie.episodes ?? [];
  const isShow = movie.contentType === "show" && episodes.length > 0;
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [startPlaying, setStartPlaying] = useState(autoPlay);

  const safeIndex = Math.min(episodeIndex, Math.max(episodes.length - 1, 0));
  const item: PlaybackFields = isShow ? episodes[safeIndex] : movie;
  const poster = thumbnailFor(item) ?? thumbnailFor(movie);
  const title = isShow ? movie.title + " · " + episodes[safeIndex].title : movie.title;
  const hasNext = isShow && safeIndex < episodes.length - 1;

  function playEpisode(index: number) {
    setEpisodeIndex(index);
    setStartPlaying(true);
  }

  return (
    <div className="video-player">
      <SourcePlayer
        key={isShow ? "episode-" + safeIndex : "main"}
        movie={movie}
        item={item}
        episodeIndex={isShow ? safeIndex : null}
        title={title}
        poster={poster}
        autoPlay={startPlaying}
        onEnded={hasNext ? () => playEpisode(safeIndex + 1) : undefined}
      />
      {isShow && <EpisodeList movie={movie} episodes={episodes} activeIndex={safeIndex} onSelect={playEpisode} />}
    </div>
  );
}
