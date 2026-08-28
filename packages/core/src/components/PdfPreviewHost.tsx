"use client";
import { useEffect } from "react";
import { closePdfPreview, usePdfPreview } from "@/store/pdf-preview-store";

export default function PdfPreviewHost() {
  const preview = usePdfPreview();

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePdfPreview();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [preview]);

  if (!preview) return null;

  const file = (preview.name || "document").replace(/\.pdf$/i, "") + ".pdf";

  function download() {
    if (preview?.status !== "ready") return;
    const a = document.createElement("a");
    a.href = preview.url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openTab() {
    if (preview?.status !== "ready") return;
    window.open(preview.url, "_blank", "noopener");
  }

  return (
    <div className="pdf-preview" role="dialog" aria-modal="true" aria-label="PDF preview">
      <div className="pdf-preview-bar">
        <div className="pdf-preview-who">
          <b>{preview.name.replace(/\.pdf$/i, "")}</b>
          <small>
            {preview.status === "loading"
              ? "Preparing PDF…"
              : preview.pages === 1
                ? "1 page"
                : preview.pages + " pages"}
          </small>
        </div>
        <div className="pdf-preview-acts">
          {preview.status === "ready" && (
            <>
              <button className="btn sm" type="button" onClick={openTab}>
                Open
              </button>
              <button className="btn sm primary" type="button" onClick={download}>
                Download
              </button>
            </>
          )}
          <button className="btn sm" type="button" onClick={closePdfPreview}>
            Close
          </button>
        </div>
      </div>
      {preview.status === "loading" ? (
        <div className="pdf-preview-wait">Preparing PDF…</div>
      ) : (
        <div className="pdf-preview-pages">
          {preview.images.map((src, i) => (
            <img key={i} className="pdf-preview-page" src={src} alt={"Page " + (i + 1)} />
          ))}
        </div>
      )}
    </div>
  );
}
