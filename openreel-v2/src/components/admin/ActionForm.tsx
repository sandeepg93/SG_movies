"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/types/admin";

interface Props {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
}

export default function ActionForm({ action, submitLabel, pendingLabel, children }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="admin-form">
      {children}
      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? pendingLabel || "Working…" : submitLabel}
        </button>
        {pending && <span className="admin-note">This can take a little while for big imports…</span>}
      </div>
      {!pending && state.message && (
        <p className={"admin-msg " + (state.ok ? "ok" : "err")} role="status">{state.message}</p>
      )}
    </form>
  );
}
