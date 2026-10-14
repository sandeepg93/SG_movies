"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string | null;
  alt: string;
  eager?: boolean;
}

export default function Thumb({ src, alt, eager = false }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  // Catches images that failed before React attached its error handler.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="thumb thumb-fallback" aria-hidden="true">
        <span>{alt.charAt(0).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      className="thumb"
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
