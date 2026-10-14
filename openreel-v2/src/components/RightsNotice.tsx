import type { Movie } from "@/types/movie";
import { rightsBasisLabel } from "@/lib/format";
import { reportMailto } from "@/lib/contact";

export default function RightsNotice({ movie }: { movie: Movie }) {
  return (
    <section className="rights-notice" aria-labelledby="rights-heading">
      <h2 id="rights-heading">Source &amp; rights</h2>
      <dl>
        {movie.rightsStatus !== "approved" && (
          <>
            <dt>Status</dt>
            <dd className="warn">Pending rights review</dd>
          </>
        )}
        <dt>Credit</dt>
        <dd>{movie.attribution}</dd>
        <dt>Basis</dt>
        <dd>{rightsBasisLabel(movie.rightsBasis)}</dd>
        {movie.licenseUrl && (
          <>
            <dt>License</dt>
            <dd><a href={movie.licenseUrl} target="_blank" rel="noopener noreferrer">View license</a></dd>
          </>
        )}
        <dt>Source</dt>
        <dd><a href={movie.sourcePageUrl} target="_blank" rel="noopener noreferrer">Original source</a></dd>
        {movie.territories.length > 0 && (
          <>
            <dt>Assessed for</dt>
            <dd>{movie.territories.join(", ")}</dd>
          </>
        )}
        {movie.rightsReviewedAt && (
          <>
            <dt>Reviewed</dt>
            <dd>{movie.rightsReviewedAt}</dd>
          </>
        )}
        {movie.rightsNotes && (
          <>
            <dt>Notes</dt>
            <dd>{movie.rightsNotes}</dd>
          </>
        )}
      </dl>
      <p className="rights-report">
        Do you hold rights to this film? <a href={reportMailto("rights_concern", movie)}>Report a rights concern</a>.
      </p>
    </section>
  );
}
