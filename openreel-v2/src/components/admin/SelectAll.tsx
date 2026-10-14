"use client";

export default function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all titles on this page"
      onChange={(event) => {
        const checked = event.currentTarget.checked;
        const form = event.currentTarget.form;
        if (!form) return;
        form.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((box) => {
          box.checked = checked;
        });
      }}
    />
  );
}
