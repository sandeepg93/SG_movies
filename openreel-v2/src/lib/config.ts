const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

export const siteConfig = {
  name: "OpenReel",
  tagline: "Hollywood, Bollywood, Marathi and Tollywood films, streamed legally from official sources.",
  url: siteUrl,
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "rights@example.com",
  // Hosts allowed for direct_video files (subdomains included).
  allowedVideoHosts: ["archive.org"] as readonly string[],
};
