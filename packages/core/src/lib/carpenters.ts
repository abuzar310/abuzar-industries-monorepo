import { allRec, delRec, getRec, put } from "./data";
import { nowIso, uid } from "./calc";
import { formDialog } from "@/store/dialog-store";
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
  village?: string;
  city?: string;
  notes?: string;
}): Promise<Carpenter> {
  let c: Carpenter | undefined;
  if (fields.id) c = await getRec<Carpenter>("carpenters", fields.id);
  if (!c) c = { id: "CARP-" + uid(), createdAt: nowIso() } as Carpenter;
  c.name = fields.name.trim();
  c.phone = (fields.phone || "").trim();
  c.village = (fields.village || "").trim();
  c.city = (fields.city || "").trim();
  c.notes = (fields.notes || "").trim();
  c.updatedAt = nowIso();
  await put("carpenters", c);
  return c;
}

export async function deleteCarpenter(id: string): Promise<void> {
  await delRec("carpenters", id);
}

/** Add/edit standalone carpenter (no customer required). */
export async function editCarpenterDialog(existing?: Carpenter): Promise<Carpenter | null> {
  const res = await formDialog({
    title: existing ? "Edit carpenter" : "Add carpenter",
    message: "Saved on its own — not linked to a customer.",
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
      { name: "village", label: "Village", value: existing?.village, placeholder: "Village (optional)" },
      { name: "city", label: "City", value: existing?.city, placeholder: "City (optional)" },
      { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Anything to remember" },
    ],
    submitLabel: existing ? "Save changes" : "Add carpenter",
  });
  if (!res) return null;
  return saveCarpenter({ id: existing?.id, ...res, name: res.name });
}
