"use client";
import { useRef, useState } from "react";
import { compressPhoto, photoInitials } from "@/lib/photo";
import { toast } from "@/store/app-store";

export default function PhotoField({
  value,
  onChange,
  size = 72,
  compact,
  name,
}: {
  value?: string;
  onChange: (dataUrl: string) => void | Promise<void>;
  size?: number;
  /** Circle only — tap opens the phone sheet (camera or gallery). */
  compact?: boolean;
  /** Used for initials when there is no photo. */
  name?: string;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const ini = photoInitials(name || "");

  async function fromFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    try {
      const url = await compressPhoto(file);
      await onChange(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not use that photo");
    } finally {
      setBusy(false);
      if (camRef.current) camRef.current.value = "";
      if (libRef.current) libRef.current.value = "";
    }
  }

  return (
    <div className="photo-field" onClick={(e) => e.stopPropagation()}>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void fromFile(e.target.files?.[0])}
      />
      <input
        ref={libRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void fromFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className={"photo-disk" + (value ? " has-pic" : "")}
        style={{ ["--photo-size" as string]: size + "px" }}
        disabled={busy}
        aria-label={value ? "Change photo" : name ? "Add photo for " + name : "Upload photo"}
        title={value ? "Change photo" : "Upload photo from this phone"}
        onClick={() => libRef.current?.click()}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" />
        ) : (
          <span className="ph-ini">{busy ? "…" : ini || "Photo"}</span>
        )}
      </button>
      {compact ? null : (
        <div className="rowbtns" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" type="button" disabled={busy} onClick={() => camRef.current?.click()}>
            Take photo
          </button>
          <button className="btn sm" type="button" disabled={busy} onClick={() => libRef.current?.click()}>
            From phone
          </button>
          {value ? (
            <button className="btn warn sm" type="button" disabled={busy} onClick={() => void onChange("")}>
              Remove
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
