import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";
import { reportMailto } from "@/lib/contact";

export const metadata: Metadata = { title: "Rights & takedowns" };

export default function RightsPage() {
  return (
    <div className="prose">
      <h1>Rights &amp; takedowns</h1>
      <h2>How we choose films</h2>
      <p>
        We only list a film when we can document why it may be streamed. That means it is in the public domain, carries an
        open license, is covered by written permission, or is an official upload by its rights holder that the platform
        allows to be embedded. For each film we record the source, the credit, the territories we assessed and the
        review date. If a film&apos;s rights are uncertain, we don&apos;t publish it.
      </p>
      <h2>Reporting a rights concern</h2>
      <p>
        If you hold rights to a film listed here, email{" "}
        <a href={reportMailto("rights_concern")}>{siteConfig.contactEmail}</a>. Include the film page link, your
        relationship to the work, and how we can verify your claim.
      </p>
      <h2>What happens next</h2>
      <ol>
        <li>We disable the film while we review your report.</li>
        <li>We keep a record of the report and of our original evidence.</li>
        <li>We review the evidence and contact the source if needed.</li>
        <li>We restore the film only if the issue is resolved, and we record the decision.</li>
      </ol>
    </div>
  );
}
