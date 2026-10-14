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
