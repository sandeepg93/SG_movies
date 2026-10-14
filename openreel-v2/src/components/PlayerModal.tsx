"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Movie } from "@/types/movie";
import Icon from "@/components/Icons";
import VideoPlayer from "@/components/VideoPlayer";
import RowCarousel from "@/components/RowCarousel";
import { industryLabel } from "@/lib/industries";
import { movieMetaLine } from "@/lib/format";

interface Props {
  movie: Movie | null;
  related: Movie[];
  onClose: () => void;
  onPlay: (movie: Movie) => void;
}

export default function PlayerModal({ movie, related, onClose, onPlay }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (movie) {
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
    } else if (dialog.open) {
      dialog.close();
    }
  }, [movie]);

  return (
    <dialog
      ref={dialogRef}
      className="player-modal"
      aria-labelledby="player-modal-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {movie && (
        <div className="modal-inner">
          <div className="modal-header">
            <h2 id="player-modal-title">{movie.title}</h2>
            <button type="button" className="icon-btn" aria-label="Close player" onClick={onClose}>
              <Icon name="close" size={20} />
            </button>
          </div>
          <VideoPlayer key={movie.id} movie={movie} autoPlay />
          <div className="modal-body">
            <div className="modal-grid">
              <div>
                <p className="detail-meta">
                  <span className="badge static badge-industry">{industryLabel(movie.industry)}</span>{" "}
                  {movieMetaLine(movie)}
                </p>
                <p>{movie.description}</p>
                {movie.genres.length > 0 && (
                  <ul className="tags">
                    {movie.genres.map((genre) => (
                      <li key={genre}><span className="tag">{genre}</span></li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="modal-side">
                {movie.director && (
                  <p className="small"><span className="muted">Director:</span> {movie.director}</p>
                )}
                {movie.cast && movie.cast.length > 0 && (
                  <p className="small"><span className="muted">Cast:</span> {movie.cast.join(", ")}</p>
                )}
                <p className="small muted">{movie.attribution}</p>
                <Link href={"/movies/" + movie.slug} className="btn">Open film page</Link>
              </div>
            </div>
            {related.length > 0 && (
              <div className="modal-related">
                <RowCarousel title="More like this" movies={related} onPlay={onPlay} />
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
