"use client";
import { useEffect, useRef, useState } from "react";
import { closeDialog, useDialog } from "@/store/dialog-store";
import PhotoField from "./PhotoField";

export default function DialogHost() {
  const dialog = useDialog();
  const [values, setValues] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // seed field values whenever a new dialog opens
  useEffect(() => {
    if (!dialog) return;
    const seed: Record<string, string> = {};
    dialog.fields.forEach((f) => (seed[f.name] = f.value ?? ""));
    setValues(seed);
    const t = setTimeout(() => firstRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [dialog]);

  if (!dialog) return null;

  const missingRequired = dialog.fields.some(
    (f) => f.required && f.type !== "photo" && !(values[f.name] || "").trim(),
  );

  function submit() {
    if (missingRequired) return;
    closeDialog(dialog!.fields.length ? values : {});
  }
  function cancel() {
    closeDialog(null);
  }

  return (
    <div className="modal-scrim" onMouseDown={cancel}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="modal-title">{dialog.title}</h3>
        {dialog.message && <p className="modal-msg">{dialog.message}</p>}
        {dialog.fields.length > 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {dialog.fields.map((f, i) =>
              f.type === "photo" ? (
                <div key={f.name} className="modal-field">
                  <span>{f.label}</span>
                  <PhotoField
                    value={values[f.name] || ""}
                    onChange={(url) => setValues((v) => ({ ...v, [f.name]: url }))}
                    size={88}
                    name={values.name}
                  />
                </div>
              ) : (
              <label key={f.name} className="modal-field">
                <span>{f.label}</span>
                {f.type === "select" ? (
                  <select
                    value={values[f.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    ref={i === 0 ? (firstRef as React.RefObject<HTMLTextAreaElement>) : undefined}
                    rows={2}
                    placeholder={f.placeholder}
                    value={values[f.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                ) : (
                  <input
                    ref={i === 0 ? (firstRef as React.RefObject<HTMLInputElement>) : undefined}
                    type={f.type === "number" ? "text" : f.type || "text"}
                    inputMode={f.inputMode || (f.type === "number" ? "decimal" : undefined)}
                    placeholder={f.placeholder}
                    value={values[f.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            <button type="submit" hidden />
          </form>
        )}
        <div className="modal-actions">
          <button className="btn sm" onClick={cancel}>
            {dialog.cancelLabel}
          </button>
          <button
            className={"btn sm " + (dialog.danger ? "warn" : "primary")}
            disabled={missingRequired}
            onClick={submit}
          >
            {dialog.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
