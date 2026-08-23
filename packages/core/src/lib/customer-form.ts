import { formDialog, type DialogField } from "@/store/dialog-store";
import { saveCustomer } from "./customers";
import { saveSupplier } from "./suppliers";
import type { Customer, Supplier } from "./types";

/** Open the add/edit customer dialog. Returns the saved customer, or null if cancelled. */
export async function editCustomerDialog(existing?: Customer): Promise<Customer | null> {
  const res = await formDialog({
    title: existing ? "Edit customer" : "Add customer",
    fields: [
      { name: "name", label: "Name", value: existing?.name, placeholder: "Customer name", required: true },
      { name: "phone", label: "Phone", type: "tel", inputMode: "numeric", value: existing?.phone, placeholder: "10-digit mobile" },
      { name: "site", label: "Carpenter name", value: existing?.site, placeholder: "Carpenter name (optional)" },
      { name: "sitePhone", label: "Carpenter phone", type: "tel", inputMode: "numeric", value: existing?.sitePhone, placeholder: "Carpenter phone (optional)" },
      { name: "siteVillage", label: "Carpenter village", value: existing?.siteVillage, placeholder: "Village (optional)" },
      { name: "siteCity", label: "Carpenter city", value: existing?.siteCity, placeholder: "City (optional)" },
      { name: "address", label: "Address", value: existing?.address, placeholder: "Full address (optional)" },
      { name: "pincode", label: "PIN code", value: existing?.pincode, placeholder: "6-digit PIN (for e-way)" },
      { name: "gstin", label: "GSTIN", value: existing?.gstin, placeholder: "GST number (optional)" },
      {
        name: "opening",
        label: "Opening balance ₹",
        type: "number",
        inputMode: "decimal",
        value: existing?.opening ? String(existing.opening) : "",
        placeholder: "old dues before app (optional)",
      },
      { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Anything to remember" },
    ],
    submitLabel: existing ? "Save changes" : "Add customer",
  });
  if (!res) return null;
  return saveCustomer({ id: existing?.id, ...res, name: res.name });
}

/** Open the add/edit supplier dialog (purchase-side contacts only). */
export async function editSupplierDialog(existing?: Supplier): Promise<Supplier | null> {
  const fields: DialogField[] = [
    { name: "name", label: "Supplier name", value: existing?.name, placeholder: "e.g. VANDANA TIMBER", required: true },
    { name: "phone", label: "Phone", type: "tel", inputMode: "numeric", value: existing?.phone, placeholder: "10-digit mobile" },
    { name: "gstin", label: "GSTIN", value: existing?.gstin, placeholder: "GST number" },
    { name: "address", label: "Address", value: existing?.address, placeholder: "Full address" },
    { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Anything to remember" },
  ];
  const res = await formDialog({
    title: existing ? "Edit supplier" : "Add supplier",
    fields,
    submitLabel: existing ? "Save changes" : "Add supplier",
  });
  if (!res) return null;
  return saveSupplier({ id: existing?.id, ...res, name: res.name });
}

/** Unofficial Buys: agent / buyer (has from-accounts underneath). */
export async function editBuyerDialog(existing?: Supplier): Promise<Supplier | null> {
  const fields: DialogField[] = [
    {
      name: "name",
      label: "Buyer / agent name",
      value: existing?.name,
      placeholder: "e.g. Dhannaram Bhai",
      required: true,
    },
    { name: "phone", label: "Phone", type: "tel", inputMode: "numeric", value: existing?.phone, placeholder: "10-digit mobile" },
    { name: "address", label: "Address", value: existing?.address, placeholder: "Optional" },
    { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Agent notes" },
  ];
  const res = await formDialog({
    title: existing ? "Edit buyer / agent" : "Add buyer / agent",
    message: "Buyer is the agent. From-accounts (yards / parties) are added on each buy row.",
    fields,
    submitLabel: existing ? "Save" : "Add buyer",
  });
  if (!res) return null;
  return saveSupplier({ id: existing?.id, ...res, name: res.name });
}
