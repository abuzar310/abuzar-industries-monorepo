import { allRec, delRec, getRec, put } from "./data";
import { nowIso, uid } from "./calc";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import { toast } from "@/store/app-store";
import type { Carpenter } from "./types";

export async function listCarpenters(): Promise<Carpenter[]> {
  const arr = await allRec<Carpenter>("carpenters");
  arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return arr;
}

export async function saveCarpenter(fields: {
  id?: string;
  name: string;
  phone?: string;
  phoneAlt?: string;
  village?: string;
  city?: string;
  notes?: string;
  photo?: string;
}): Promise<Carpenter> {
  let c: Carpenter | undefined;
  if (fields.id) c = await getRec<Carpenter>("carpenters", fields.id);
  if (!c) c = { id: "CARP-" + uid(), createdAt: nowIso() } as Carpenter;
  c.name = fields.name.trim();
  c.phone = (fields.phone || "").trim();
  if (fields.phoneAlt !== undefined) {
    const alt = fields.phoneAlt.trim();
    if (alt) c.phoneAlt = alt;
    else delete c.phoneAlt;
  }
  c.village = (fields.village || "").trim();
  c.city = (fields.city || "").trim();
  c.notes = (fields.notes || "").trim();
  if (fields.photo !== undefined) {
    if (fields.photo) c.photo = fields.photo;
    else delete c.photo;
  }
  c.updatedAt = nowIso();
  await put("carpenters", c);
  return c;
}

export async function setCarpenterPhoto(
  r: {
    record?: Carpenter;
    name: string;
    phone: string;
    phoneAlt?: string;
    village: string;
    city: string;
    notes: string;
  },
  photo: string,
): Promise<Carpenter> {
  const e = r.record;
  return saveCarpenter({
    id: e?.id,
    name: (e?.name || r.name).trim(),
    phone: e?.phone || r.phone,
    phoneAlt: e?.phoneAlt || r.phoneAlt,
    village: e?.village || r.village,
    city: e?.city || r.city,
    notes: e?.notes || r.notes,
    photo,
  });
}

export async function deleteCarpenter(id: string): Promise<void> {
  await delRec("carpenters", id);
}

/** Add/edit standalone carpenter (no customer required). `"deleted"` if they used Delete in the dialog. */
export async function editCarpenterDialog(existing?: Carpenter): Promise<Carpenter | "deleted" | null> {
  const res = await formDialog({
    title: existing ? "Edit carpenter" : "Add carpenter",
    message: "Saved on its own — not linked to a customer. Photo is taken on this phone.",
    fields: [
      { name: "name", label: "Name", value: existing?.name, placeholder: "Carpenter name", required: true },
      {
        name: "phone",
        label: "Phone",
        type: "tel",
        inputMode: "numeric",
        value: existing?.phone,
        placeholder: "10-digit mobile",
      },
      {
        name: "phoneAlt",
        label: "Alternative number",
        type: "tel",
        inputMode: "numeric",
        value: existing?.phoneAlt,
        placeholder: "Second mobile (optional)",
      },
      { name: "village", label: "Village", value: existing?.village, placeholder: "Village (optional)" },
      { name: "city", label: "City", value: existing?.city, placeholder: "City (optional)" },
      { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Anything to remember" },
      { name: "photo", label: "Photo", type: "photo", value: existing?.photo },
    ],
    submitLabel: existing ? "Save changes" : "Add carpenter",
    deleteLabel: existing?.id ? "Delete" : undefined,
  });
  if (!res) return null;
  if (res.__action === "delete") {
    if (!existing?.id) return null;
    const ok = await confirmDialog({
      title: "Delete " + (existing.name || "this carpenter") + "?",
      message: "Removes this carpenter contact only. Customers and commission payouts stay.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return null;
    await deleteCarpenter(existing.id);
    toast("Carpenter deleted");
    return "deleted";
  }
  return saveCarpenter({ id: existing?.id, ...res, name: res.name, photo: res.photo ?? existing?.photo ?? "" });
}
