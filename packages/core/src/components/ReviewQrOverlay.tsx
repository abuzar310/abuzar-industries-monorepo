"use client";
// Full-screen review flyer — exact /review-qr.png (QR baked to funnel ?go=1).
import { useEffect } from "react";
import { hideReviewQr, useReviewQrOpen } from "@/store/review-qr-store";

export default function ReviewQrOverlay() {
  const open = useReviewQrOpen();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") hideReviewQr();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="review-qr-overlay no-print"
      role="dialog"
      aria-modal="true"
      aria-label="Google review QR"
      onClick={hideReviewQr}
    >
      <div className="review-qr-panel review-qr-panel--flyer ph-kit" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="review-qr-close" onClick={hideReviewQr} aria-label="Close">
          ×
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="review-qr-flyer"
          src="/review-qr.png?v=go1"
          alt="Scan to leave a Google review — Abuzar Industries"
        />
      </div>
    </div>
  );
}
