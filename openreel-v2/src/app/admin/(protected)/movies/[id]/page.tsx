import Link from "next/link";
import { notFound } from "next/navigation";
import MovieForm from "@/components/admin/MovieForm";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { deleteMovieAction } from "@/app/admin/actions";
import { loadCatalog } from "@/lib/store";
import { toFormValues } from "@/lib/admin/form";
import { validateRecord } from "@/lib/validation";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function EditMoviePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const wanted = safeDecode(id);
  const record = loadCatalog().raw.find((r) => r.id === wanted || r.id === id);
  if (!record) notFound();

  const recordId = String(record.id);
  const title = String(record.title || "(untitled)");
  const slug = typeof record.slug === "string" ? record.slug : "";
  const problems = validateRecord(record);
  const isLive = record.rightsStatus === "approved" && problems.length === 0;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <p className="admin-crumb"><Link href="/admin">Titles</Link> / Edit</p>
          <h1>{title}</h1>
        </div>
        <div className="admin-head-actions">
          {slug && (
            <Link className="btn" href={"/movies/" + slug} target="_blank">
              {isLive ? "View on site ↗" : "Preview ↗"}
            </Link>
          )}
          <form action={deleteMovieAction}>
            <input type="hidden" name="id" value={recordId} />
            <ConfirmButton className="btn btn-danger" message={"Delete \"" + title + "\" permanently?"}>Delete</ConfirmButton>
          </form>
        </div>
      </div>

      {sp.saved && <p className="admin-msg ok" role="status">Saved. {isLive ? "It's live on the site now." : "It's not public until its status is Live."}</p>}
      {sp.added && <p className="admin-msg info" role="status">Imported as Pending. Check the details and rights, then set Status to Live and save.</p>}
      {problems.length > 0 && (
        <div className="admin-errors">
          <strong>This title is hidden from the site until these are fixed:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <MovieForm initial={toFormValues(record)} originalId={recordId} mode="edit" />
    </div>
  );
}
