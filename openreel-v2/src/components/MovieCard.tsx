"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { Movie } from "@/types/movie";
import Thumb from "@/components/Thumb";
import Icon from "@/components/Icons";
import { thumbnailFor } from "@/lib/media";
import { industryLabel } from "@/lib/industries";
import { formatRuntime } from "@/lib/format";
import { formatShortRelease } from "@/lib/dates";

interface Props {
  movie: Movie;
  onPlay?: (movie: Movie) => void;
}

export default function MovieCard({ movie, onPlay }: Props) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onPlay) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onPlay(movie);
  }

  const isShow = movie.contentType === "show";
  const meta = [formatShortRelease(movie), movie.languages[0] ?? ""].filter(Boolean).join(" · ");

  return (
    <li className="card">
      <Link
        href={"/movies/" + movie.slug}
        className="card-link"
        onClick={handleClick}
        aria-label={(onPlay ? "Play " : "Open ") + movie.title}
      >
        <div className="card-media">
          <Thumb src={thumbnailFor(movie)} alt={movie.title} />
          <span className="badge badge-industry">{industryLabel(movie.industry)}</span>
          {isShow && <span className="badge badge-show">{"Series · " + (movie.episodes?.length ?? 0) + " ep"}</span>}
          {!isShow && movie.runtimeMinutes !== undefined && (
            <span className="badge badge-duration">{formatRuntime(movie.runtimeMinutes)}</span>
          )}
          {movie.rightsStatus !== "approved" && <span className="badge badge-pending">Pending</span>}
          <span className="card-play" aria-hidden="true">
            <Icon name="play" />
          </span>
        </div>
        <div className="card-body">
          <h3 className="card-title">{movie.title}</h3>
          {meta && <p className="card-meta">{meta}</p>}
        </div>
      </Link>
    </li>
  );
}
