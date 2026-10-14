import Link from "next/link";
import MovieForm from "@/components/admin/MovieForm";
import { toFormValues } from "@/lib/admin/form";

export default function NewMoviePage() {
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <p className="admin-crumb"><Link href="/admin">Titles</Link> / New</p>
          <h1>Add a title</h1>
        </div>
        <div className="admin-head-actions">
          <Link className="btn" href="/admin/import">Quick add from a link instead</Link>
        </div>
      </div>
      <MovieForm initial={toFormValues(null)} originalId="" mode="create" />
    </div>
  );
}
