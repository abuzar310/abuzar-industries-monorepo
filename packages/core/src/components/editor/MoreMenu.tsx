"use client";
import { useEffect, useRef, useState } from "react";

/** Overflow "⋯ More" menu for secondary editor actions. Closes on outside click / Escape. */
export default function MoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="moremenu" ref={ref}>
      <button className="btn sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        More ▾
      </button>
      {open && (
        <div className="moremenu-pop" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
