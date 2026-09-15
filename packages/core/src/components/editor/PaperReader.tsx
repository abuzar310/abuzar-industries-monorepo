"use client";
import { useEffect, useRef, useState } from "react";
import { preparePaperPhoto, readPaperPhoto } from "@/lib/paper-client";
import type { PaperApply } from "@/lib/paper-quote";

export type PaperJob = {
  id: string;
  thumb: string;
  image: string;
  photo: string;
  state: "reading" | "error";
  message: string;
  startedAt: number;
};

/** Reads scanned photos in the background. Lines land on the quotation through apply; a failed read stays with Try again. */
export function usePaperReader(apply: (got: PaperApply) => void) {
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
    try {
      const got = await readPaperPhoto(job.image);
      if (!alive.current || dropped.current.has(job.id)) return;
      applyRef.current({ lines: got.lines, customerName: got.customerName, paperPhoto: job.photo });
      setJobs((all) => all.filter((j) => j.id !== job.id));
    } catch (e) {
      if (!alive.current || dropped.current.has(job.id)) return;
      const message = e instanceof Error ? e.message : "Could not read that photo. Tap Try again.";
      setJobs((all) => all.map((j) => (j.id === job.id ? { ...j, state: "error" as const, message } : j)));
    }
  }

  async function start(file: File) {
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      const { image, photo } = await preparePaperPhoto(file);
      const job: PaperJob = { id, thumb: photo, image, photo, state: "reading", message: "", startedAt: Date.now() };
      setJobs((all) => [...all, job]);
      void run(job);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not open that photo";
      setJobs((all) => [...all, { id, thumb: "", image: "", photo: "", state: "error", message, startedAt: Date.now() }]);
    }
  }

  function retry(id: string) {
    const job = jobs.find((j) => j.id === id);
    if (!job || !job.image) return;
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

/** One row per photo being read, under the toolbar. */
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
            <span className="paper-job-pic" aria-hidden="true" />
          )}
          <span className="paper-job-text">
            {j.state === "reading" ? (
              <>
                <span className="paper-spin" aria-hidden="true" />
                Reading the paper list…
                {now > j.startedAt ? <span aria-hidden="true">{Math.round((now - j.startedAt) / 1000)}s</span> : null}
              </>
            ) : (
              j.message
            )}
          </span>
          <span className="paper-job-acts">
            {j.state === "error" && j.image ? (
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
