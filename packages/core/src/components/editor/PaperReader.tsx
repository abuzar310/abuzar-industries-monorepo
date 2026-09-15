"use client";
import { useEffect, useRef, useState } from "react";
import { pdfDataUrl, preparePaperPhoto, readPaperSource, type PaperSource } from "@/lib/paper-client";
import type { PaperApply } from "@/lib/paper-quote";
import { importKind, readSheetFile } from "@/lib/sheet-import";

/** A photo keeps its picture on the quotation; a file (Excel, CSV, PDF) switches the print to the long list. */
export type PaperKind = "photo" | "file";

export type PaperJob = {
  id: string;
  kind: PaperKind;
  /** Shown instead of a thumbnail for a file. */
  tag: string;
  thumb: string;
  source: PaperSource | null;
  photo: string;
  state: "reading" | "error";
  message: string;
  startedAt: number;
};

/** Reads photos and files in the background. Lines land on the quotation through apply; a failed read stays with Try again. */
export function usePaperReader(apply: (got: PaperApply, kind: PaperKind) => void) {
  const [jobs, setJobs] = useState<PaperJob[]>([]);
  const applyRef = useRef(apply);
  const alive = useRef(true);
  const dropped = useRef(new Set<string>());

  useEffect(() => {
    applyRef.current = apply;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run(job: PaperJob) {
    if (!job.source) return;
    try {
      const got = await readPaperSource(job.source);
      if (!alive.current || dropped.current.has(job.id)) return;
      applyRef.current({ lines: got.lines, customerName: got.customerName, paperPhoto: job.photo }, job.kind);
      setJobs((all) => all.filter((j) => j.id !== job.id));
    } catch (e) {
      if (!alive.current || dropped.current.has(job.id)) return;
      const message = e instanceof Error ? e.message : "Could not read that list. Tap Try again.";
      setJobs((all) => all.map((j) => (j.id === job.id ? { ...j, state: "error" as const, message } : j)));
    }
  }

  /** A photo, a PDF or a sheet. A sheet whose columns are clear lands at once; anything else goes to the reader. */
  async function start(file: File) {
    const kind = importKind(file);
    const base = {
      id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: (kind === "image" ? "photo" : "file") as PaperKind,
      tag: kind === "pdf" ? "PDF" : kind === "image" ? "" : "XLS",
      thumb: "",
      photo: "",
      startedAt: Date.now(),
    };
    try {
      let job: PaperJob;
      if (kind === "image") {
        const { image, photo } = await preparePaperPhoto(file);
        job = { ...base, thumb: photo, photo, source: { image }, state: "reading", message: "" };
      } else if (kind === "pdf") {
        job = { ...base, source: { pdf: await pdfDataUrl(file) }, state: "reading", message: "" };
      } else if (kind === "sheet") {
        const got = await readSheetFile(file);
        if ("read" in got) {
          if (alive.current) {
            applyRef.current({ lines: got.read.lines, customerName: got.read.customerName, paperPhoto: "" }, "file");
          }
          return;
        }
        job = { ...base, source: { text: got.text }, state: "reading", message: "" };
      } else {
        throw new Error("Send an Excel, CSV or PDF file, or a photo of the list");
      }
      setJobs((all) => [...all, job]);
      void run(job);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not open that file";
      setJobs((all) => [...all, { ...base, source: null, state: "error", message }]);
    }
  }

  function retry(id: string) {
    const job = jobs.find((j) => j.id === id);
    if (!job || !job.source) return;
    const again: PaperJob = { ...job, state: "reading", message: "", startedAt: Date.now() };
    setJobs((all) => all.map((j) => (j.id === id ? again : j)));
    void run(again);
  }

  function dismiss(id: string) {
    dropped.current.add(id);
    setJobs((all) => all.filter((j) => j.id !== id));
  }

  return { jobs, start, retry, dismiss };
}

/** One row per photo or file being read, under the toolbar. */
export function PaperJobsBar({
  jobs,
  onRetry,
  onDismiss,
}: {
  jobs: PaperJob[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [now, setNow] = useState(0);
  const reading = jobs.some((j) => j.state === "reading");

  useEffect(() => {
    if (!reading) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [reading]);

  if (!jobs.length) return null;
  return (
    <div className="paper-jobs no-print ph-kit">
      {jobs.map((j) => (
        <div key={j.id} className={"paper-job" + (j.state === "error" ? " is-error" : "")} role={j.state === "error" ? "alert" : "status"}>
          {j.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="paper-job-pic" src={j.thumb} alt="" />
          ) : (
            <span className="paper-job-pic paper-job-tag" aria-hidden="true">
              {j.tag}
            </span>
          )}
          <span className="paper-job-text">
            {j.state === "reading" ? (
              <>
                <span className="paper-spin" aria-hidden="true" />
                {j.kind === "photo" ? "Reading the paper list…" : "Reading the file…"}
                {now > j.startedAt ? <span aria-hidden="true">{Math.round((now - j.startedAt) / 1000)}s</span> : null}
              </>
            ) : (
              j.message
            )}
          </span>
          <span className="paper-job-acts">
            {j.state === "error" && j.source ? (
              <button className="btn primary sm" type="button" onClick={() => onRetry(j.id)}>
                Try again
              </button>
            ) : null}
            <button className="btn sm" type="button" onClick={() => onDismiss(j.id)}>
              {j.state === "reading" ? "Cancel" : "Close"}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
