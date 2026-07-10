import { formDialog, type DialogField } from "@/store/dialog-store";
import { saveCustomer } from "./customers";
import type { Customer } from "./types";

/** Open the add/edit customer (or supplier) dialog. Returns the saved record, or null if cancelled. */
export async function editCustomerDialog(
  existing?: Customer,
  opts?: { asSupplier?: boolean },
): Promise<Customer | null> {
  const asSupplier = !!opts?.asSupplier;
  const noun = asSupplier ? "supplier" : "customer";
  const fields: DialogField[] = [
    {
      name: "name",
      label: "Name",
      value: existing?.name,
      placeholder: asSupplier ? "Supplier name" : "Customer name",
      required: true,
    },
    {
      name: "phone",
      label: "Phone",
      type: "tel",
      inputMode: "numeric",
      value: existing?.phone,
      placeholder: "10-digit mobile",
    },
  ];
  if (!asSupplier) {
    fields.push({
      name: "site",
      label: "Carpenter",
      value: existing?.site,
      placeholder: "Carpenter name (optional)",
    });
  }
  fields.push(
    { name: "address", label: "Address", value: existing?.address, placeholder: "Full address (optional)" },
    { name: "gstin", label: "GSTIN", value: existing?.gstin, placeholder: "GST number (optional)" },
  );
  if (!asSupplier) {
    fields.push({
      name: "opening",
      label: "Opening balance ₹",
      type: "number",
      inputMode: "decimal",
      value: existing?.opening ? String(existing.opening) : "",
      placeholder: "old dues before app (optional)",
    });
  }
  fields.push({
    name: "notes",
    label: "Notes",
    type: "textarea",
    value: existing?.notes,
    placeholder: "Anything to remember",
  });

  const res = await formDialog({
    title: existing ? `Edit ${noun}` : `Add ${noun}`,
    fields,
    submitLabel: existing ? "Save changes" : asSupplier ? "Add supplier" : "Add customer",
  });
  if (!res) return null;
  return saveCustomer({ id: existing?.id, ...res, name: res.name });
}
