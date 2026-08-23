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
  darkColor = "#1a1410",
  lightColor = "#ffffff",
  asLink = true,
}: {
  size?: number;
  /** Override brand review URL (e.g. funnel deep-link). */
  url?: string;
  label?: string;
  className?: string;
  darkColor?: string;
  lightColor?: string;
  asLink?: boolean;
}) {
  const brand = activeBrand();
  // Sheet QR prefers the review funnel; WhatsApp still uses reviewUrl separately.
  const href = (url || brand.reviewFunnelUrl || brand.reviewUrl || "").trim();
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
      color: { dark: darkColor, light: lightColor },
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
  }, [href, size, darkColor, lightColor]);

  if (!href || !src) return null;

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={label || "Google review QR"} width={size} height={size} />
  );

  if (!asLink) {
    return (
      <div className={"review-qr" + (className ? " " + className : "")} title={label || "Rate us on Google"}>
        {img}
        {label ? <span className="review-qr-label">{label}</span> : null}
      </div>
    );
  }

  return (
    <a
      className={"review-qr" + (className ? " " + className : "")}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label || "Rate us on Google"}
    >
      {img}
      {label ? <span className="review-qr-label">{label}</span> : null}
    </a>
  );
}
