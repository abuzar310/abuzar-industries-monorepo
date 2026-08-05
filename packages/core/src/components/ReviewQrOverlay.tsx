"use client";
// Full-screen review flyer after money is accepted (owner/manager) — also
// opened from the quotation toolbar "Review" button. Image lives at /review-qr.jpg
// in each app's public folder (copied from images/QR-code.JPG).
import { hideReviewQr, useReviewQrOpen } from "@/store/review-qr-store";

export default function ReviewQrOverlay() {
  const open = useReviewQrOpen();
  if (!open) return null;

  return (
    <div
      className="review-qr-overlay no-print"
      role="dialog"
      aria-modal="true"
      aria-label="Google review QR"
      onClick={hideReviewQr}
    >
      <div className="review-qr-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="review-qr-close" onClick={hideReviewQr} aria-label="Close">
          ×
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="review-qr-img" src="/review-qr.jpg" alt="Scan to leave a Google review — Abuzar Industries" />
        <button type="button" className="btn primary review-qr-done" onClick={hideReviewQr}>
          Done
        </button>
      </div>
    </div>
  );
}
