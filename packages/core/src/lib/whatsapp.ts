import { activeBrand } from "./brand";
import { cftOf, computeDoc, inr } from "./calc";
import type { Doc } from "./types";

export function waLink(phone: string, text: string): string {
  let p = (phone || "").replace(/[^0-9]/g, "");
  if (p.length === 10) p = "91" + p;
  return "https://wa.me/" + p + "?text=" + encodeURIComponent(text);
}

export function quoteMessage(doc: Doc): string {
  const b = activeBrand();
  const t = computeDoc(doc);
  const lines = doc.sections
    .map((s) => {
      let cft = 0;
      s.rows.forEach((r) => (cft += cftOf(r)));
      return `• ${s.name}: ${cft.toFixed(2)} CFT @ ₹${s.rate}/CFT`;
    })
    .join("\n");
  const kind = doc.kind === "invoice" ? "Invoice" : "Quotation";
  const sign = [b.name, [b.phone, b.web].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  return `Assalamu Alaikum ${doc.customerName || ""},
${b.name} — ${kind} ${doc.number}

${lines}

Sub-total: ₹${inr(t.sub)}
GST (${doc.gst}%): ₹${inr(t.gstAmt)}
Grand Total: ₹${inr(t.grand)}

Thank you,
${sign}`;
}

export function reminderMessage(doc: Doc): string {
  const b = activeBrand();
  return `Assalamu Alaikum ${doc.customerName || ""},
This is ${b.name}.
Regarding your timber enquiry and quotation ${doc.number}, we wanted to follow up. Please let us know if you would like to proceed. Thank you.`;
}

export function customerFollowupMessage(name: string): string {
  return `Assalamu Alaikum ${name},\nThis is ${activeBrand().name}. Following up on your timber enquiry — please let us know if you would like to proceed. Thank you.`;
}
