"use client";
import { useEffect, useRef, useState } from "react";

/** Overflow "⋯ More" menu. Positioned with fixed coords + up/down flip so it's always
 *  fully visible (never clipped off the top/bottom of the screen). */
export default function MoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const openUp = window.innerHeight - r.bottom < 260; // little room below → open upward
      setPos({
        right: Math.max(8, window.innerWidth - r.right),
        ...(openUp ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div className="moremenu" ref={wrapRef}>
      <button ref={btnRef} className="btn sm" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        More ▾
      </button>
      {open && pos && (
        <div
          className="moremenu-pop"
          role="menu"
          style={{ position: "fixed", right: pos.right, top: pos.top, bottom: pos.bottom }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
