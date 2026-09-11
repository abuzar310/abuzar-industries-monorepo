import { allRec, delRec, getRec, put } from "./data";
import { nowIso, uid } from "./calc";
import { carpenterKey, carpenterSeed, isShopName, sameCarpenterSeed } from "./carpenter-financials";
import { confirmDialog, formDialog } from "@/store/dialog-store";
import { toast } from "@/store/app-store";
import type { Carpenter, Customer, Doc, Expense } from "./types";

export async function listCarpenters(): Promise<Carpenter[]> {
  const arr = await allRec<Carpenter>("carpenters");
  arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return arr;
}

function last10(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

/** Keep the existing photo unless the user set a new one or clicked Remove (""). */
export function nextCarpenterPhoto(
  prev: string | undefined,
  incoming: string | undefined,
  opts?: { allowBlankRemove?: boolean },
): string | undefined {
  if (incoming === "") {
    if (opts?.allowBlankRemove === false) return prev || undefined;
    return undefined;
  }
  if (incoming) return incoming;
  return prev || undefined;
}

/** The directory row behind a Carpenters-tab card — never invent a second person. */
export function resolveCarpenterRecord(
  r: { record?: Carpenter; name: string; phone?: string; phoneAlt?: string },
  directory: Carpenter[],
): Carpenter | undefined {
  if (r.record?.id) return directory.find((c) => c.id === r.record!.id) || r.record;
  const key = carpenterKey(r.name);
  const seed = carpenterSeed(r.name);
  const named = directory.filter((c) => carpenterKey(c.name) === key);
  const related = directory.filter((c) => {
    const ck = carpenterKey(c.name);
    if (isShopName(c.name) && isShopName(r.name) && sameCarpenterSeed(c.name, r.name)) return true;
    if (!seed || seed.length < 4) return false;
    if ((seed === "ismail" || seed === "suresha") && !(isShopName(c.name) && isShopName(r.name))) return false;
    return ck === seed || ck.startsWith(seed + " ") || key.startsWith(ck + " ");
  });
  const pool = [...new Map([...named, ...related].map((c) => [c.id, c])).values()];
  const phones = [r.phone, r.phoneAlt].map((p) => last10(p || "")).filter((p) => p.length >= 10);
  if (phones.length) {
    const byPhone = directory.find((c) => phones.includes(last10(c.phone)) || phones.includes(last10(c.phoneAlt || "")));
    if (byPhone) return byPhone;
  }
  const rich = pool.filter((c) => last10(c.phone).length >= 10 || !!c.photo);
  if (rich.length === 1) return rich[0];
  if (rich.length > 1) return rich.find((c) => last10(c.phone).length >= 10) || rich[0];
  if (named.length === 1) return named[0];
  if (pool.length === 1) return pool[0];
  return undefined;
}

async function retargetCarpenterAlias(fromName: string, toName: string): Promise<void> {
  const from = carpenterKey(fromName);
  const to = toName.trim();
  if (!from || !to || from === carpenterKey(to)) return;
  const quotes = await allRec<Doc>("quotations");
  const customers = await allRec<Customer>("customers");
  const expenses = await allRec<Expense>("expenses");
  for (const d of quotes) {
    let changed = false;
    if (carpenterKey(d.site || "") === from) {
      d.site = to;
      changed = true;
    }
    if (d.commLock && carpenterKey(d.commLock.carpenter || "") === from) {
      d.commLock = { ...d.commLock, carpenter: to };
      changed = true;
    }
    if (changed) await put("quotations", d);
  }
  for (const c of customers) {
    if (carpenterKey(c.site || "") !== from) continue;
    c.site = to;
    await put("customers", c);
  }
  for (const e of expenses) {
    if (carpenterKey(e.carpenter || "") !== from) continue;
    e.carpenter = to;
    await put("expenses", e);
  }
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
  /** Quote/customer site name on the card being edited — may differ from the directory row. */
  fromName?: string;
}): Promise<Carpenter> {
  const all = await listCarpenters();
  let c: Carpenter | undefined;
  if (fields.id) {
    c = (await getRec<Carpenter>("carpenters", fields.id)) || all.find((x) => x.id === fields.id);
    if (!c) c = { id: fields.id, createdAt: nowIso() } as Carpenter;
  }
  if (!c) {
    const nameKey = carpenterKey(fields.name);
    const fromKey = carpenterKey(fields.fromName || "");
    const phone = last10(fields.phone || "");
    c =
      (nameKey ? all.find((x) => carpenterKey(x.name) === nameKey) : undefined) ||
      (fromKey ? all.find((x) => carpenterKey(x.name) === fromKey) : undefined) ||
      (phone.length >= 10
        ? all.find((x) => last10(x.phone) === phone || last10(x.phoneAlt || "") === phone)
        : undefined);
  }
  const oldName = (c?.name || "").trim();
  if (!c) c = { id: "CARP-" + uid(), createdAt: nowIso() } as Carpenter;
  const photo = nextCarpenterPhoto(c.photo, fields.photo, { allowBlankRemove: !!fields.id });
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
  if (photo) c.photo = photo;
  else delete c.photo;
  c.updatedAt = nowIso();
  await put("carpenters", c);
  const seen = new Set<string>();
  for (const alias of [oldName, fields.fromName]) {
    const k = carpenterKey(alias || "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    await retargetCarpenterAlias(alias!, c.name);
  }
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
    fromName: r.name,
  });
}

export async function deleteCarpenter(id: string): Promise<void> {
  await delRec("carpenters", id);
}

/** Add/edit standalone carpenter (no customer required). `"deleted"` if they used Delete in the dialog. */
export async function editCarpenterDialog(
  existing?: Carpenter,
  fromName?: string,
): Promise<Carpenter | "deleted" | null> {
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
  return saveCarpenter({
    id: existing?.id,
    name: res.name,
    phone: res.phone,
    phoneAlt: res.phoneAlt,
    village: res.village,
    city: res.city,
    notes: res.notes,
    photo: res.photo,
    fromName: fromName || existing?.name,
  });
}
