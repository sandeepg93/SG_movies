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
