import { formDialog } from "@/store/dialog-store";
import { saveCustomer } from "./customers";
import type { Customer } from "./types";

/** Open the add/edit customer dialog. Returns the saved customer, or null if cancelled. */
export async function editCustomerDialog(existing?: Customer): Promise<Customer | null> {
  const res = await formDialog({
    title: existing ? "Edit customer" : "Add customer",
    fields: [
      { name: "name", label: "Name", value: existing?.name, placeholder: "Customer name", required: true },
      { name: "phone", label: "Phone", type: "tel", inputMode: "numeric", value: existing?.phone, placeholder: "10-digit mobile" },
      { name: "site", label: "Site", value: existing?.site, placeholder: "Delivery site / town" },
      { name: "address", label: "Address", value: existing?.address, placeholder: "Full address (optional)" },
      { name: "gstin", label: "GSTIN", value: existing?.gstin, placeholder: "GST number (optional)" },
      { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Anything to remember" },
    ],
    submitLabel: existing ? "Save changes" : "Add customer",
  });
  if (!res) return null;
  return saveCustomer({ id: existing?.id, ...res, name: res.name });
}
