import { createQuotation } from "./create";
import { getRec, prefGet } from "./data";
import { parsePaperRead } from "./paper-quote";
import { compressPhoto, PAPER_READ } from "./photo";
import type { Doc } from "./types";

/** Photos and files picked on Home or the empty editor wait here, in memory only, until their quotation opens. */
const pending = new Map<string, File>();

export function takePendingPaper(docId: string): File | null {
  const file = pending.get(docId) ?? null;
  pending.delete(docId);
  return file;
}

/** Where a scan or file from Home lands: the quotation open last, or a new draft when none is open. Returns its id. */
export async function paperTargetQuote(file: File): Promise<string> {
  const last = prefGet<{ store: string; id: string } | null>("lastOpen", null);
  const open = last?.store === "quotations" && last.id ? await getRec<Doc>("quotations", last.id) : null;
  const id = open && !open.deletedAt && !open.purgedAt ? open.id : (await createQuotation()).id;
  pending.set(id, file);
  return id;
}

/** A sharp copy to read and a small copy kept on the quotation. */
export async function preparePaperPhoto(file: File): Promise<{ image: string; photo: string }> {
  const [image, photo] = await Promise.all([compressPhoto(file, PAPER_READ), compressPhoto(file)]);
  return { image, photo };
}

/** What the reader is sent: a photo, a PDF, or a sheet's rows as text. */
export type PaperSource = { image: string } | { pdf: string } | { text: string };

/** Vercel refuses request bodies over 4.5 MB, and base64 makes a file a third bigger. */
export const PDF_MAX_BYTES = 3_000_000;

export async function pdfDataUrl(file: File): Promise<string> {
  if (file.size > PDF_MAX_BYTES) throw new Error("That PDF is over 3 MB. Send a smaller one, or a photo of the list.");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not open that PDF"));
    reader.readAsDataURL(file);
  });
  // some phones give a PDF no type, so the prefix is set here rather than trusted
  return "data:application/pdf;base64," + url.slice(url.indexOf(",") + 1);
}

/** A little longer than the server's own 60 seconds, so its answer arrives first. */
const READ_TIMEOUT_MS = 70_000;

/** Ask the server to read it. Every failure comes back as a sentence the yard can act on. */
export async function readPaperSource(source: PaperSource) {
  let r: Response;
  try {
    r = await fetch("/api/ai/paper", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(source),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (e) {
    const late = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new Error(late ? "The list reader took too long. Tap Try again." : "No connection. Check the internet, then tap Try again.");
  }
  const data = (await r.json().catch(() => null)) as { error?: string } | null;
  if (!r.ok) {
    if (data?.error) throw new Error(data.error);
    if (r.status === 413) throw new Error("That file is too big to send. Try a smaller one.");
    throw new Error(
      r.status === 504 || r.status === 502 ? "The list reader took too long. Tap Try again." : "Could not read that list. Tap Try again.",
    );
  }
  const parsed = parsePaperRead(data);
  if (!parsed.lines.length) throw new Error("No sizes found in that list");
  return parsed;
}
