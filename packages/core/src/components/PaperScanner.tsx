"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  frameDetail,
  frameMotion,
  lumaFrame,
  scanStep,
  SCAN_SAMPLE_MS,
  SCAN_W,
  type ScanHint,
  type ScanState,
} from "@/lib/paper-scan";

type Hint = ScanHint | "start";

const HINT_TEXT: Record<Hint, string> = {
  start: "Opening the camera…",
  aim: "Point the camera at the list",
  hold: "Hold the phone still",
  focus: "Waiting for a sharp picture",
  capture: "Got it",
};

function cameraError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera is blocked for this site. Allow it in the browser, or upload a photo.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Upload a photo instead.";
  return "The camera did not open. Upload a photo instead.";
}

type ScanProps = { onPhoto: (file: File) => void; onClose: () => void };

const noSubscribe = () => () => undefined;

/** Full-screen camera, placed on <body>: a fixed layer inside the transformed .view scrolls away with the page. */
export default function PaperScanner(props: ScanProps) {
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  return onClient ? createPortal(<ScanLayer {...props} />, document.body) : null;
}

/** Takes the photo by itself once the list is steady and sharp. Upload photo picks one instead. */
function ScanLayer({ onPhoto, onClose }: ScanProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const grabNow = useRef<() => void>(() => undefined);
  const taken = useRef(false);
  const onPhotoRef = useRef(onPhoto);
  const onCloseRef = useRef(onClose);
  const [hint, setHint] = useState<Hint>("start");
  const [progress, setProgress] = useState(0);
  const [camError, setCamError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    onPhotoRef.current = onPhoto;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let prev: Float32Array | null = null;
    let state: ScanState = { steady: 0, best: 0 };
    let lastHint: ScanHint = "aim";
    const small = document.createElement("canvas");

    function stop() {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    }

    function grab() {
      const video = videoRef.current;
      if (taken.current || !video || !video.videoWidth) return;
      taken.current = true;
      window.clearInterval(timer);
      const full = document.createElement("canvas");
      full.width = video.videoWidth;
      full.height = video.videoHeight;
      full.getContext("2d")?.drawImage(video, 0, 0, full.width, full.height);
      full.toBlob(
        (blob) => {
          if (stopped) return;
          stop();
          if (blob) onPhotoRef.current(new File([blob], "scan.jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.92,
      );
    }

    function tick() {
      const video = videoRef.current;
      if (stopped || taken.current || !video || video.readyState < 2 || !video.videoWidth) return;
      const h = Math.max(1, Math.round((video.videoHeight * SCAN_W) / video.videoWidth));
      small.width = SCAN_W;
      small.height = h;
      const ctx = small.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, SCAN_W, h);
      const y = lumaFrame(ctx.getImageData(0, 0, SCAN_W, h).data, SCAN_W, h);
      const { sharp, edges } = frameDetail(y, SCAN_W, h);
      const motion = prev ? frameMotion(prev, y) : 255;
      prev = y;
      const step = scanStep(state, { motion, sharp, edges });
      state = step.state;
      // A new hint shows only when two samples in a row agree, so the words hold still while the phone moves.
      if (step.hint === lastHint || step.capture) setHint(step.hint);
      lastHint = step.hint;
      setProgress(step.progress);
      if (step.capture) grab();
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
      } catch (e) {
        if (!stopped) setCamError(cameraError(e));
        return;
      }
      const video = videoRef.current;
      if (stopped || !video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (stopped) return;
      setHint("aim");
      grabNow.current = grab;
      timer = window.setInterval(tick, SCAN_SAMPLE_MS);
    }

    void start();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      stop();
    };
  }, []);

  return (
    <div className="paper-scan" role="dialog" aria-modal="true" aria-label="Scan paper">
      <div className="paper-scan-top">
        <b>Scan paper</b>
        <button ref={closeRef} type="button" className="paper-scan-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="paper-scan-view">
        {camError ? (
          <p className="paper-scan-msg" role="alert">{camError}</p>
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="paper-scan-frame" aria-hidden="true" />
          </>
        )}
      </div>
      {!camError && (
        <div className="paper-scan-hint" aria-live="polite">
          <span className="paper-scan-bar" aria-hidden="true">
            <i style={{ width: Math.round(progress * 100) + "%" }} />
          </span>
          {HINT_TEXT[hint]}
        </div>
      )}
      <div className="paper-scan-acts">
        <button type="button" className={"btn" + (camError ? " primary" : "")} onClick={() => uploadRef.current?.click()}>
          Upload photo
        </button>
        {!camError ? (
          <button type="button" className="btn" disabled={hint === "start"} onClick={() => grabNow.current()}>
            Scan now
          </button>
        ) : null}
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || taken.current) return;
          taken.current = true;
          onPhotoRef.current(file);
        }}
      />
    </div>
  );
}
