import Link from "next/link";
import type { Movie } from "@/types/movie";
import { loadCatalog } from "@/lib/store";
import { rowAction } from "@/app/admin/actions";
import { INDUSTRIES, industryLabel } from "@/lib/industries";
import { thumbnailFor } from "@/lib/media";
import ConfirmButton from "@/components/admin/ConfirmButton";
import SelectAll from "@/components/admin/SelectAll";

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 50;
const STATUS_LABELS: Record<string, string> = {
  approved: "Live",
  pending_review: "Pending",
  rejected: "Rejected",
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.status);
  const industry = one(sp.industry);
  const type = one(sp.type);
  const msg = one(sp.msg);
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const { raw, problems } = loadCatalog();
  const invalidIds = new Set(problems.map((p) => p.id));
  const movies = raw.map((r) => r as unknown as Partial<Movie>);
  const countStatus = (s: string) => movies.filter((m) => m.rightsStatus === s).length;

  const needle = q.toLowerCase();
  const filtered = movies.filter((m) => {
    if (status === "invalid") {
      if (!invalidIds.has(String(m.id ?? ""))) return false;
    } else if (status && m.rightsStatus !== status) {
      return false;
    }
    if (industry && m.industry !== industry) return false;
    if (type && (m.contentType === "show" ? "show" : "movie") !== type) return false;
    if (needle) {
      const hay = [m.title, m.id, m.slug, m.director, m.playbackId, ...(m.genres ?? [])].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function href(overrides: Record<string, string>): string {
    const values: Record<string, string> = { q, status, industry, type, page: String(currentPage), ...overrides };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === "page" && value === "1")) params.set(key, value);
    }
    const text = params.toString();
    return "/admin" + (text ? "?" + text : "");
  }
  const returnTo = href({});

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Titles</h1>
          <p className="admin-crumb">Approve titles to publish them. Changes appear on the site immediately.</p>
        </div>
        <div className="admin-head-actions">
          <Link className="btn" href="/admin/import">Import</Link>
          <Link className="btn btn-primary" href="/admin/movies/new">+ Add title</Link>
        </div>
      </div>

      {msg && <p className="admin-msg info" role="status">{msg}</p>}

      <div className="admin-stats">
        <Link className={"admin-stat" + (status === "" ? " is-active" : "")} href={href({ status: "", page: "1" })}>
          <b>{movies.length}</b><span>All titles</span>
        </Link>
        <Link className={"admin-stat" + (status === "approved" ? " is-active" : "")} href={href({ status: "approved", page: "1" })}>
          <b>{countStatus("approved")}</b><span>Live on site</span>
        </Link>
        <Link className={"admin-stat" + (status === "pending_review" ? " is-active" : "")} href={href({ status: "pending_review", page: "1" })}>
          <b>{countStatus("pending_review")}</b><span>Pending review</span>
        </Link>
        <Link className={"admin-stat" + (status === "rejected" ? " is-active" : "")} href={href({ status: "rejected", page: "1" })}>
          <b>{countStatus("rejected")}</b><span>Rejected</span>
        </Link>
        <Link className={"admin-stat" + (status === "invalid" ? " is-active" : "")} href={href({ status: "invalid", page: "1" })}>
          <b>{problems.length}</b><span>Hidden (need fixing)</span>
        </Link>
      </div>

      {problems.length > 0 && (
        <div className="admin-errors">
          <strong>{problems.length} title(s) are hidden from the site because of errors:</strong>
          <ul className="admin-problems">
            {problems.slice(0, 8).map((p) => (
              <li key={p.index}>
                {p.id ? <Link href={"/admin/movies/" + encodeURIComponent(p.id)}>{p.title}</Link> : p.title} — {p.errors.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="admin-filters" action="/admin" method="get">
        <input type="search" name="q" defaultValue={q} placeholder="Search title, ID, director, category…" />
        <select name="status" defaultValue={status}>
          <option value="">Any status</option>
          <option value="approved">Live</option>
          <option value="pending_review">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="invalid">Hidden (errors)</option>
        </select>
        <select name="industry" defaultValue={industry}>
          <option value="">All industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
        <select name="type" defaultValue={type}>
          <option value="">Movies &amp; shows</option>
          <option value="movie">Movies</option>
          <option value="show">Shows</option>
        </select>
        <button type="submit" className="btn">Filter</button>
        {(q || status || industry || type) && <Link href="/admin" className="link-button">Reset</Link>}
      </form>

      <form action={rowAction}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="admin-bulk">
          <span className="admin-note">{filtered.length} title(s). With ticked:</span>
          <button type="submit" className="btn btn-xs btn-ok" name="target" value="bulk-approve">Publish</button>
          <button type="submit" className="btn btn-xs" name="target" value="bulk-pending">Set pending</button>
          <button type="submit" className="btn btn-xs" name="target" value="bulk-reject">Reject</button>
          <ConfirmButton className="btn btn-xs btn-danger" name="target" value="bulk-delete" message="Delete all ticked titles permanently?">
            Delete
          </ConfirmButton>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th><SelectAll /></th>
                <th><span className="sr-only">Thumbnail</span></th>
                <th>Title</th>
                <th>Industry</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-note">No titles match. Try another filter, or import some titles.</td>
                </tr>
              )}
              {pageItems.map((m, index) => {
                const id = String(m.id ?? "");
                const title = String(m.title || "(untitled)");
                const invalid = invalidIds.has(id);
                const thumb = thumbnailFor(m as unknown as Movie);
                const year = m.releaseDate ? m.releaseDate.slice(0, 4) : m.releaseYear ? String(m.releaseYear) : "";
                return (
                  <tr key={id || "row-" + index}>
                    <td>{id && <input type="checkbox" name="ids" value={id} aria-label={"Select " + title} />}</td>
                    <td>
                      <div className="admin-thumb">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        ) : null}
                      </div>
                    </td>
                    <td className="admin-title-cell">
                      {id ? <Link href={"/admin/movies/" + encodeURIComponent(id)}>{title}</Link> : title}
                      <span className="admin-sub">
                        {[m.contentType === "show" ? "Show · " + (m.episodes?.length ?? 0) + " episodes" : "Movie", year, (m.genres ?? []).join(", "), m.playbackType]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td>{m.industry ? industryLabel(m.industry) : "—"}</td>
                    <td>
                      {invalid ? (
                        <span className="status status-invalid">Needs fixing</span>
                      ) : (
                        <span className={"status status-" + String(m.rightsStatus)}>{STATUS_LABELS[String(m.rightsStatus)] ?? String(m.rightsStatus)}</span>
                      )}
                    </td>
                    <td>
                      {id && (
                        <div className="row-actions">
                          {m.rightsStatus !== "approved" && (
                            <button type="submit" className="btn btn-xs btn-ok" name="target" value={"approve|" + id}>Publish</button>
                          )}
                          {m.rightsStatus !== "pending_review" && (
                            <button type="submit" className="btn btn-xs" name="target" value={"pending|" + id}>Pending</button>
                          )}
                          {m.rightsStatus !== "rejected" && (
                            <button type="submit" className="btn btn-xs" name="target" value={"reject|" + id}>Reject</button>
                          )}
                          <button type="submit" className={"btn btn-xs" + (m.featured ? " is-on" : "")} name="target" value={"feature|" + id} title="Featured in the home banner">★</button>
                          <button type="submit" className={"btn btn-xs" + (m.trending ? " is-on" : "")} name="target" value={"trending|" + id} title="Pin to Trending">🔥</button>
                          <Link className="btn btn-xs" href={"/admin/movies/" + encodeURIComponent(id)}>Edit</Link>
                          <ConfirmButton className="btn btn-xs btn-danger" name="target" value={"delete|" + id} message={"Delete \"" + title + "\" permanently?"}>
                            Delete
                          </ConfirmButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>

      {totalPages > 1 && (
        <nav className="admin-pager" aria-label="Pages">
          {currentPage > 1 && <Link className="btn btn-xs" href={href({ page: String(currentPage - 1) })}>← Previous</Link>}
          <span className="admin-note">Page {currentPage} of {totalPages}</span>
          {currentPage < totalPages && <Link className="btn btn-xs" href={href({ page: String(currentPage + 1) })}>Next →</Link>}
        </nav>
      )}
    </div>
  );
}
