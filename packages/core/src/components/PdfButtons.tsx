"use client";

/** Preview first, then download. Quotation/invoice sheets keep Print only. */
export default function PdfButtons({
  onPreview,
  onDownload,
  busy,
  downloadLabel = "PDF",
}: {
  onPreview: () => void;
  onDownload: () => void;
  busy?: boolean;
  downloadLabel?: string;
}) {
  return (
    <>
      <button
        className="btn sm"
        type="button"
        disabled={busy}
        title="Look at the PDF before downloading"
        onClick={onPreview}
      >
        Preview
      </button>
      <button
        className="btn sm"
        type="button"
        disabled={busy}
        title="Download PDF"
        onClick={onDownload}
      >
        {downloadLabel}
      </button>
    </>
  );
}
