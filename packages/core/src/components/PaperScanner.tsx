"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  CROP_FULL,
  cropPixels,
  dragCrop,
  frameDetail,
  frameMotion,
  isFullCrop,
  lumaFrame,
  scanStep,
  SCAN_SAMPLE_MS,
  SCAN_W,
  type CropBox,
  type CropGrip,
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

type ScanProps = {
  onPhoto: (file: File) => void;
  onClose: () => void;
  /** A photo picked elsewhere: skip the camera and crop this one. */
  file?: File;
};

const noSubscribe = () => () => undefined;

/** Full-screen camera, placed on <body>: a fixed layer inside the transformed .view scrolls away with the page. */
export default function PaperScanner(props: ScanProps) {
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  return onClient ? createPortal(<ScanLayer {...props} />, document.body) : null;
}

/** Takes the photo by itself once the list is steady and sharp, then shows it for cropping before it is read. */
function ScanLayer({ onPhoto, onClose, file }: ScanProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const grabNow = useRef<() => void>(() => undefined);
  const taken = useRef(false);
  const onPhotoRef = useRef(onPhoto);
  const onCloseRef = useRef(onClose);
  const [shot, setShot] = useState<File | null>(file ?? null);
  const [hint, setHint] = useState<Hint>("start");
  const [progress, setProgress] = useState(0);
  const [camError, setCamError] = useState("");

  useEffect(() => {
    onPhotoRef.current = onPhoto;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, []);

  // the camera runs only while there is no photo to crop; Retake clears the photo and starts it again
  const cameraOn = !shot;
  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let prev: Float32Array | null = null;
    let state: ScanState = { steady: 0, best: 0 };
    let lastHint: ScanHint = "aim";
    const small = document.createElement("canvas");
    taken.current = false;

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
          if (blob) setShot(new File([blob], "scan.jpg", { type: "image/jpeg" }));
          else setCamError("The photo did not save. Upload a photo instead.");
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
    return stop;
  }, [cameraOn]);

  function retake() {
    setCamError("");
    setHint("start");
    setProgress(0);
    setShot(null);
  }

  return (
    <div className="paper-scan" role="dialog" aria-modal="true" aria-label={shot ? "Crop the list" : "Scan paper"}>
      <div className="paper-scan-top">
        <b>{shot ? "Crop the list" : "Scan paper"}</b>
        <button ref={closeRef} type="button" className="paper-scan-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {shot ? (
        <PaperCrop
          key={shot.size + ":" + shot.lastModified}
          file={shot}
          onUse={(f) => onPhotoRef.current(f)}
          onRetake={retake}
        />
      ) : (
        <>
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
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) setShot(picked);
            }}
          />
        </>
      )}
    </div>
  );
}

/** The photo with a box to drag around the list. The whole photo starts selected, so Read list alone sends it as is. */
function PaperCrop({ file, onUse, onRetake }: { file: File; onUse: (f: File) => void; onRetake: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ grip: CropGrip; x: number; y: number; box: CropBox } | null>(null);
  const [url, setUrl] = useState("");
  const [box, setBox] = useState<CropBox>(CROP_FULL);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  function down(grip: CropGrip, e: PointerEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    areaRef.current?.setPointerCapture(e.pointerId);
    drag.current = { grip, x: e.clientX, y: e.clientY, box };
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const rect = imgRef.current?.getBoundingClientRect();
    if (!d || !rect || !rect.width || !rect.height) return;
    setBox(dragCrop(d.box, d.grip, (e.clientX - d.x) / rect.width, (e.clientY - d.y) / rect.height));
  }

  function up() {
    drag.current = null;
  }

  function read() {
    const img = imgRef.current;
    if (busy || !img || !img.naturalWidth) return;
    if (isFullCrop(box)) {
      onUse(file);
      return;
    }
    const { sx, sy, sw, sh } = cropPixels(box, img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    setBusy(true);
    canvas.toBlob(
      (blob) => {
        setBusy(false);
        onUse(blob ? new File([blob], "list.jpg", { type: "image/jpeg" }) : file);
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <>
      <div className="paper-scan-view">
        {url ? (
          <div ref={areaRef} className="paper-crop" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={url}
              alt="Photo of the list"
              draggable={false}
              // a photo this browser can't show (an iPhone HEIC in Chrome) goes to the reader uncropped
              onError={() => onUse(file)}
            />
            <div
              className="paper-crop-box"
              style={{ left: box.x * 100 + "%", top: box.y * 100 + "%", width: box.w * 100 + "%", height: box.h * 100 + "%" }}
              onPointerDown={(e) => down("move", e)}
            >
              {(["nw", "ne", "sw", "se"] as const).map((g) => (
                <i key={g} className={"paper-crop-h " + g} onPointerDown={(e) => down(g, e)} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="paper-scan-hint">Drag the corners around the list, then tap Read list</div>
      <div className="paper-scan-acts">
        <button type="button" className="btn" onClick={onRetake}>
          Retake
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={read}>
          Read list
        </button>
      </div>
    </>
  );
}
