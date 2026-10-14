"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { Movie } from "@/types/movie";
import Thumb from "@/components/Thumb";
import { formatReleaseDate } from "@/lib/dates";
import { formatRuntime } from "@/lib/format";
import { thumbnailFor } from "@/lib/media";
import { industryLabel } from "@/lib/industries";

interface Props {
  movies: Movie[];
  onPlay?: (movie: Movie) => void;
}

export default function MovieList({ movies, onPlay }: Props) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>, movie: Movie) {
    if (!onPlay) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onPlay(movie);
  }

  return (
    <div className="table-wrap">
      <table className="movie-table">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Thumbnail</span></th>
            <th scope="col">Title</th>
            <th scope="col">Industry</th>
            <th scope="col">Released</th>
            <th scope="col">Category</th>
            <th scope="col">Language</th>
            <th scope="col">Runtime</th>
          </tr>
        </thead>
        <tbody>
          {movies.map((movie) => (
            <tr key={movie.id}>
              <td>
                <Link
                  href={"/movies/" + movie.slug}
                  className="table-thumb"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={(e) => handleClick(e, movie)}
                >
                  <Thumb src={thumbnailFor(movie)} alt={movie.title} />
                </Link>
              </td>
              <th scope="row">
                <Link href={"/movies/" + movie.slug} onClick={(e) => handleClick(e, movie)}>{movie.title}</Link>
                {movie.rightsStatus !== "approved" && <span className="pending-tag">Pending</span>}
              </th>
              <td>{industryLabel(movie.industry)}</td>
              <td>{formatReleaseDate(movie) || "—"}</td>
              <td>{movie.genres.join(", ") || "—"}</td>
              <td>{movie.languages.join(", ") || "—"}</td>
              <td>{formatRuntime(movie.runtimeMinutes) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
