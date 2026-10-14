"use client";

import type { ReactNode } from "react";

interface Props {
  message: string;
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
}

export default function ConfirmButton({ message, children, className, name, value }: Props) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
