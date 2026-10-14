import { siteConfig } from "@/lib/config";

export type ReportKind = "broken_playback" | "rights_concern";

export function reportMailto(kind: ReportKind, movie?: { title: string; slug: string }): string {
  const subject =
    kind === "broken_playback"
      ? "Broken playback: " + (movie ? movie.title : "unknown film")
      : "Rights concern" + (movie ? ": " + movie.title : "");

  const body = [
    movie ? "Film: " + movie.title : "",
    movie ? "Page: " + siteConfig.url + "/movies/" + movie.slug : "",
    "",
    kind === "rights_concern"
      ? "Please describe your rights claim and how we can verify it:"
      : "What happened (device, browser, error message)?",
    "",
  ].join("\n");

  return "mailto:" + siteConfig.contactEmail + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}
