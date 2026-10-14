import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="prose">
      <h1>Privacy</h1>
      <p>
        {siteConfig.name} has no user accounts, sets no cookies of its own, and uses no analytics or advertising trackers.
        If you watch videos in our own player, your playback position may be saved in your browser so you can resume later.
        That information stays on your device.
      </p>
      <p>
        Films play in embedded players from third parties such as YouTube (privacy-enhanced mode) and the Internet Archive.
        When you press play, that provider may receive your IP address, set cookies and show its own ads, under its own
        privacy policy. Thumbnails are loaded from those providers too.
      </p>
      <p>Questions: <a href={"mailto:" + siteConfig.contactEmail}>{siteConfig.contactEmail}</a></p>
    </div>
  );
}
