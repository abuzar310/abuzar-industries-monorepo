import { formDialog } from "@/store/dialog-store";
import { saveVendor } from "./ledger";
import type { Vendor } from "./types";

/** Open the add/edit vendor (creditor) dialog. Returns the saved vendor, or null if cancelled. */
export async function editVendorDialog(existing?: Vendor): Promise<Vendor | null> {
  const res = await formDialog({
    title: existing ? "Edit vendor" : "Add vendor",
    fields: [
      { name: "name", label: "Name", value: existing?.name, placeholder: "Vendor / supplier name", required: true },
      { name: "phone", label: "Phone", type: "tel", inputMode: "numeric", value: existing?.phone, placeholder: "10-digit mobile" },
      { name: "address", label: "Address", value: existing?.address, placeholder: "Full address (optional)" },
      { name: "gstin", label: "GSTIN", value: existing?.gstin, placeholder: "GST number (optional)" },
      { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, placeholder: "Anything to remember" },
    ],
    submitLabel: existing ? "Save changes" : "Add vendor",
  });
  if (!res) return null;
  return saveVendor({ id: existing?.id, ...res, name: res.name });
}
