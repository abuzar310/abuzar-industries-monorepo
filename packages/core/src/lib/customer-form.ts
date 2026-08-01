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
      { name: "site", label: "Carpenter", value: existing?.site, placeholder: "Carpenter name (optional)" },
      { name: "sitePhone", label: "Carpenter phone", value: existing?.sitePhone, placeholder: "Carpenter phone (optional)" },
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

/** Unofficial Buys: same suppliers store, buyer wording. */
export async function editBuyerDialog(existing?: Supplier): Promise<Supplier | null> {
  const fields: DialogField[] = [
    { name: "name", label: "Buyer name", value: existing?.name, placeholder: "Who you bought from", required: true },
    { name: "phone", label: "Phone", type: "tel", inputMode: "numeric", value: existing?.phone, placeholder: "10-digit mobile" },
    { name: "address", label: "Address", value: existing?.address, placeholder: "Optional" },
    { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Anything to remember" },
  ];
  const res = await formDialog({
    title: existing ? "Edit buyer" : "Add buyer",
    fields,
    submitLabel: existing ? "Save" : "Add buyer",
  });
  if (!res) return null;
  return saveSupplier({ id: existing?.id, ...res, name: res.name });
}
