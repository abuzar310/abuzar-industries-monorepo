// The .xlsx open/save worker: multi-MB files parse here, never on the page's thread.
import ExcelJS from "exceljs";
import { excelFromSnapshot, snapshotFromExcel, type UniSnapshot, type XBook } from "./xlsx-convert";

type Job =
  | { id: number; kind: "import"; buf: ArrayBuffer }
  | { id: number; kind: "export"; snapshot: UniSnapshot };

self.onmessage = async (e: MessageEvent<Job>) => {
  const job = e.data;
  const post = (msg: object, transfer?: Transferable[]) =>
    (self as unknown as { postMessage: (m: object, t?: Transferable[]) => void }).postMessage({ id: job.id, ...msg }, transfer);
  try {
    if (job.kind === "import") {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(job.buf);
      post({ ok: true, snapshot: snapshotFromExcel(wb as unknown as XBook) });
    } else {
      const wb = new ExcelJS.Workbook();
      excelFromSnapshot(job.snapshot, wb as unknown as XBook);
      const raw = (await wb.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
      const buf = raw instanceof ArrayBuffer ? raw : (raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
      post({ ok: true, buf }, [buf]);
    }
  } catch (err) {
    post({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
