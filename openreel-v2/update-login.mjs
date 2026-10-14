// update-login.mjs — run inside openreel-v2:  node update-login.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ACTIONS = "src/app/admin/actions.ts";
if (!existsSync(ACTIONS) || !existsSync("src/lib/admin/auth.ts")) {
  console.error("Run this inside openreel-v2, after update-admin.mjs.");
  process.exit(1);
}

const files = {};

files["src/lib/admin/auth.ts"] = String.raw`
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
`;

files["src/components/admin/LoginForm.tsx"] = String.raw`
"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/admin/actions";
import type { ActionState } from "@/types/admin";

export default function LoginForm({ showDefaultHint }: { showDefaultHint: boolean }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={formAction} className="admin-form admin-card">
      <h1>Admin login</h1>
      {showDefaultHint && (
        <p className="admin-note">
          Default login: username <strong>admin</strong>, password <strong>admin</strong>.
        </p>
      )}
      <label className="admin-field">
        <span className="admin-label">Username</span>
        <input name="username" autoComplete="username" defaultValue="admin" required autoFocus />
      </label>
      <label className="admin-field">
        <span className="admin-label">Password</span>
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Checking…" : "Log in"}
        </button>
      </div>
      {state.message && <p className="admin-msg err" role="alert">{state.message}</p>}
    </form>
  );
}
`;

files["src/app/admin/login/page.tsx"] = String.raw`
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminConfigured, isAdmin, usingDefaultCredentials } from "@/lib/admin/auth";
import LoginForm from "@/components/admin/LoginForm";
import "../admin.css";

export const metadata: Metadata = { title: "Admin login", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <div className="admin-login">
      {adminConfigured() ? (
        <LoginForm showDefaultHint={usingDefaultCredentials() && process.env.NODE_ENV !== "production"} />
      ) : (
        <div className="admin-card">
          <h1>Change the default login first</h1>
          <p>
            This is a live (production) server, so the default <strong>admin / admin</strong> login is turned off for safety.
            Add your own login to <code>.env.local</code> and restart:
          </p>
          <code className="admin-code">{"ADMIN_USERNAME=your-name\nADMIN_PASSWORD=a-strong-password"}</code>
        </div>
      )}
    </div>
  );
}
`;

files["src/app/admin/(protected)/layout.tsx"] = String.raw`
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
`;

// ---- patch the login action in actions.ts (exact replacements, verified) ----
const replacements = [
  [
    'import { adminConfigured, checkPassword, endSession, requireAdmin, startSession } from "@/lib/admin/auth";',
    'import { adminConfigured, checkCredentials, endSession, requireAdmin, startSession } from "@/lib/admin/auth";',
  ],
  [
    'return { ok: false, message: "Admin is disabled. Set ADMIN_PASSWORD (8+ characters) in .env.local and restart the server." };',
    'return { ok: false, message: "The default admin / admin login is disabled on a live server. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.local and restart." };',
  ],
  [
    'if (!checkPassword(str(form, "password"))) {',
    'if (!checkCredentials(str(form, "username"), str(form, "password"))) {',
  ],
  [
    'return { ok: false, message: "Wrong password." };',
    'return { ok: false, message: "Wrong username or password." };',
  ],
];

let actions = readFileSync(ACTIONS, "utf8");
if (actions.includes("checkCredentials(")) {
  console.log("actions.ts already updated — skipping patch.");
} else {
  for (const [from, to] of replacements) {
    if (!actions.includes(from)) {
      console.error("Could not find this line in " + ACTIONS + ":\n  " + from + "\nNothing was changed. Paste this message in the chat.");
      process.exit(1);
    }
  }
  for (const [from, to] of replacements) actions = actions.replace(from, to);
}

for (const [path, content] of Object.entries(files)) {
  writeFileSync(path, content.replace(/^\r?\n/, ""), "utf8");
  console.log("Wrote " + path);
}
writeFileSync(ACTIONS, actions, "utf8");
console.log("Updated " + ACTIONS);

console.log("\nDone. Restart with: npm run dev");
console.log("Log in at http://localhost:3000/admin with username: admin  password: admin");
