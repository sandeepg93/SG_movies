import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin, usingDefaultCredentials } from "@/lib/admin/auth";
import { logoutAction } from "@/app/admin/actions";
import "../admin.css";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="admin">
      {usingDefaultCredentials() && (
        <p className="admin-msg err" role="alert">
          You&apos;re using the default login <strong>admin / admin</strong>. Before putting the site online, set
          ADMIN_USERNAME and ADMIN_PASSWORD in .env.local and restart the server.
        </p>
      )}
      <nav className="admin-nav" aria-label="Admin">
        <strong>OpenReel admin</strong>
        <Link href="/admin">Titles</Link>
        <Link href="/admin/movies/new">Add title</Link>
        <Link href="/admin/import">Import &amp; sources</Link>
        <Link href="/" target="_blank">View site ↗</Link>
        <form action={logoutAction}>
          <button type="submit" className="link-button">Log out</button>
        </form>
      </nav>
      {children}
    </div>
  );
}
