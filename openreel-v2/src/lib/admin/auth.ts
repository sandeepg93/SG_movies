import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "openreel_admin";
const SESSION_HOURS = 12;
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";

export function adminUsername(): string {
  return (process.env.ADMIN_USERNAME || DEFAULT_USERNAME).trim();
}

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
}

/** True while the login is still the default admin / admin. */
export function usingDefaultCredentials(): boolean {
  return adminUsername() === DEFAULT_USERNAME && adminPassword() === DEFAULT_PASSWORD;
}

/**
 * Login is always available in development.
 * In production the default admin / admin is refused unless ADMIN_ALLOW_DEFAULT=true.
 */
export function adminConfigured(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return !usingDefaultCredentials() || process.env.ADMIN_ALLOW_DEFAULT === "true";
}

// A random per-server secret is used when ADMIN_SECRET isn't set, so sessions can't be forged
// even though the default password is public. (Kept on globalThis so dev hot-reloads don't log you out.)
const globalForAdmin = globalThis as typeof globalThis & { __openreelAdminSecret?: string };

function secret(): string {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  if (!globalForAdmin.__openreelAdminSecret) globalForAdmin.__openreelAdminSecret = randomBytes(32).toString("hex");
  return globalForAdmin.__openreelAdminSecret;
}

/** Changes whenever the username or password changes, which invalidates old sessions. */
function credentialFingerprint(): string {
  return createHash("sha256").update(adminUsername() + "\n" + adminPassword()).digest("hex").slice(0, 16);
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value + ":" + credentialFingerprint()).digest("hex");
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(username: string, password: string): boolean {
  if (!adminConfigured()) return false;
  const userOk = safeEqual(username.trim(), adminUsername());
  const passOk = safeEqual(password, adminPassword());
  return userOk && passOk;
}

function verifyToken(token: string | undefined): boolean {
  if (!token || !adminConfigured()) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!safeEqual(sign(payload), signature)) return false;
  return Number(payload) > Date.now();
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}

/** Use at the top of every admin page and server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function startSession(): Promise<void> {
  const expires = String(Date.now() + SESSION_HOURS * 3600000);
  const store = await cookies();
  store.set(SESSION_COOKIE, expires + "." + sign(expires), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NEXT_PUBLIC_SITE_URL || "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
