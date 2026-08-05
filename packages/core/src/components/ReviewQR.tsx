"use client";
// Printable Google-review QR — shared by QuoteCanvas / invoice footer / landing.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { activeBrand } from "@/lib/brand";

export default function ReviewQR({
  size = 88,
  url,
  label = "Rate us on Google",
  className = "",
}: {
  size?: number;
  /** Override brand.reviewUrl (e.g. landing page). */
  url?: string;
  label?: string;
  className?: string;
}) {
  const href = (url || activeBrand().reviewUrl || "").trim();
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!href) {
      setSrc("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(href, {
      width: size * 2,
      margin: 1,
      color: { dark: "#1a1410", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((data) => {
        if (!cancelled) setSrc(data);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [href, size]);

  if (!href || !src) return null;

  return (
    <a
      className={"review-qr" + (className ? " " + className : "")}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} width={size} height={size} />
      <span className="review-qr-label">{label}</span>
    </a>
  );
}
