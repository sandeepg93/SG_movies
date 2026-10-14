import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import "./enhancements.css";
import { siteConfig } from "@/lib/config";
import { isPreviewMode } from "@/lib/catalog";
import { INDUSTRIES } from "@/lib/industries";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: siteConfig.name, template: "%s · " + siteConfig.name },
  description: siteConfig.tagline,
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {isPreviewMode() && (
          <div className="preview-banner" role="note">
            Local preview: films pending rights review are visible. They are never shown in production.
          </div>
        )}
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="logo">
              <span className="logo-mark" aria-hidden="true">▶</span>
              {siteConfig.name}
            </Link>
            <nav className="industry-nav" aria-label="Film industries">
              {INDUSTRIES.map((industry) => (
                <Link key={industry.value} href={"/?industry=" + industry.value}>{industry.label}</Link>
              ))}
            </nav>
            <form className="header-search" action="/" method="get" role="search">
              <label htmlFor="site-search" className="sr-only">Search films</label>
              <input id="site-search" type="search" name="q" placeholder="Search films, actors, years…" />
            </form>
          </div>
        </header>
        <main id="main" className="container">{children}</main>
        <footer className="site-footer">
          <div className="container footer-inner">
            <nav className="footer-nav" aria-label="Footer">
              <Link href="/about">About</Link>
              <Link href="/rights">Rights &amp; takedowns</Link>
              <Link href="/privacy">Privacy</Link>
              <a href={"mailto:" + siteConfig.contactEmail}>Contact</a>
            </nav>
            <p className="muted small">
              © {new Date().getFullYear()} {siteConfig.name}. All films are credited to and streamed from their rights holders.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
