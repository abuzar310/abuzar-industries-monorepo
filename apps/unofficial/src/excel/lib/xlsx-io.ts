// Main-thread side of .xlsx open and save: one lasting worker, one promise per job.
import type { UniSnapshot } from "./xlsx-convert";

type Reply = { id: number; ok: boolean; error?: string; snapshot?: UniSnapshot; buf?: ArrayBuffer };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./xlsx.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const wait = waiting.get(e.data.id);
      if (!wait) return;
      waiting.delete(e.data.id);
      if (e.data.ok) wait.resolve(e.data);
      else wait.reject(new Error(e.data.error || "The file could not be read"));
    };
    worker.onerror = () => {
      for (const [id, wait] of waiting) {
        waiting.delete(id);
        wait.reject(new Error("The file reader stopped. Try again."));
      }
    };
  }
  return worker;
}

function call(msg: object, transfer?: Transferable[]): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, ...msg }, transfer ?? []);
  });
}

export const freshId = () => "wb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function importXlsx(file: File): Promise<UniSnapshot> {
  const buf = await file.arrayBuffer();
  const reply = await call({ kind: "import", buf }, [buf]);
  const snapshot = reply.snapshot!;
  if (!snapshot.sheetOrder.length) throw new Error("No sheets found in that file");
  snapshot.id = freshId();
  snapshot.name = file.name.replace(/\.[^.]+$/, "");
  return snapshot;
}

export async function exportXlsx(snapshot: UniSnapshot, name: string): Promise<void> {
  const reply = await call({ kind: "export", snapshot });
  const blob = new Blob([reply.buf!], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (name.trim() || "Book") + ".xlsx";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
