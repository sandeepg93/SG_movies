import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import VideoPlayer from "@/components/VideoPlayer";
import RightsNotice from "@/components/RightsNotice";
import RowCarousel from "@/components/RowCarousel";
import { getMovieBySlug, getRelatedMovies } from "@/lib/catalog";
import { MONTH_NAMES, getReleaseMonth, getReleaseYear } from "@/lib/dates";
import { formatRuntime, movieMetaLine } from "@/lib/format";
import { industryLabel } from "@/lib/industries";

// Always render from the live catalog so admin changes appear immediately.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const movie = getMovieBySlug(slug);
  if (!movie) return { title: "Not found" };
  return {
    title: movie.title,
    description: movie.description,
    alternates: { canonical: "/movies/" + movie.slug },
  };
}

export default async function MoviePage({ params }: Props) {
  const { slug } = await params;
  const movie = getMovieBySlug(slug);
  if (!movie) notFound();

  const year = getReleaseYear(movie);
  const month = getReleaseMonth(movie);
  const related = getRelatedMovies(movie, 12);

  return (
    <article className="detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true"> / </span>
        <Link href={"/?industry=" + movie.industry}>{industryLabel(movie.industry)}</Link>
      </nav>

      {movie.rightsStatus !== "approved" && (
        <p className="preview-banner inline-banner" role="note">
          Pending rights review. This page is visible only in local preview.
        </p>
      )}

      <div className="detail-player">
        <VideoPlayer movie={movie} />
      </div>

      <div className="detail-layout">
        <div>
          <h1 className="detail-title">{movie.title}</h1>
          {movie.alternateTitles && movie.alternateTitles.length > 0 && (
            <p className="muted small">Also known as: {movie.alternateTitles.join(", ")}</p>
          )}
          <p className="detail-meta">
            <span className="badge static badge-industry">{industryLabel(movie.industry)}</span> {movieMetaLine(movie)}
          </p>
          <p className="detail-desc">{movie.description}</p>

          <dl className="facts">
            {movie.director && (
              <>
                <dt>Director</dt>
                <dd><Link href={"/?q=" + encodeURIComponent(movie.director)}>{movie.director}</Link></dd>
              </>
            )}
            {movie.cast && movie.cast.length > 0 && (
              <>
                <dt>Cast</dt>
                <dd>
                  {movie.cast.map((person, i) => (
                    <span key={person}>
                      {i > 0 && ", "}
                      <Link href={"/?q=" + encodeURIComponent(person)}>{person}</Link>
                    </span>
                  ))}
                </dd>
              </>
            )}
            <dt>Released</dt>
            <dd>
              {year === undefined ? (
                "Unknown"
              ) : (
                <>
                  {month !== undefined && (
                    <>
                      <Link href={"/?year=" + year + "&month=" + month}>{MONTH_NAMES[month - 1]}</Link>{" "}
                    </>
                  )}
                  <Link href={"/?year=" + year}>{year}</Link>
                </>
              )}
            </dd>
            {movie.runtimeMinutes !== undefined && (
              <>
                <dt>Runtime</dt>
                <dd>{formatRuntime(movie.runtimeMinutes)}</dd>
              </>
            )}
            <dt>Industry</dt>
            <dd><Link href={"/?industry=" + movie.industry}>{industryLabel(movie.industry)}</Link></dd>
            {movie.genres.length > 0 && (
              <>
                <dt>Categories</dt>
                <dd>
                  <ul className="tags">
                    {movie.genres.map((genre) => (
                      <li key={genre}>
                        <Link className="tag" href={"/?category=" + encodeURIComponent(genre)}>{genre}</Link>
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            <dt>Language</dt>
            <dd>
              <ul className="tags">
                {movie.languages.map((language) => (
                  <li key={language}>
                    <Link className="tag" href={"/?lang=" + encodeURIComponent(language)}>{language}</Link>
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
        </div>
        <aside>
          <RightsNotice movie={movie} />
        </aside>
      </div>

      {related.length > 0 && (
        <div className="section">
          <RowCarousel title="More like this" movies={related} />
        </div>
      )}
    </article>
  );
}
