import type { Metadata } from "next";
import { siteConfig } from "@/lib/config";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="prose">
      <h1>About {siteConfig.name}</h1>
      <p>
        {siteConfig.name} brings together full-length Hollywood, Bollywood, Marathi and Tollywood films that are
        legally available to stream for free. Some are public-domain classics; others are official uploads by the
        films&apos; own rights holders.
      </p>
      <p>
        We don&apos;t host or copy any video. Every film plays inside {siteConfig.name} through its official source&apos;s
        player, such as YouTube or the Internet Archive, and is credited to its rights holder.
      </p>
    </div>
  );
}
