import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>Page not found</h1>
      <p>This film isn&apos;t available, or the link is wrong.</p>
      <p><Link href="/" className="btn">Browse all films</Link></p>
    </div>
  );
}
