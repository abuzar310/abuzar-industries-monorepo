import { qty } from "./calc";
import { REAL_BRAND } from "./brand";

export type PermitFields = { leaf: string; book: string; form: string; oldDate: string };

export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function permitHeadHtml() {
  const from = esc(REAL_BRAND.name);
  const addrLine = esc(
    [REAL_BRAND.addr, REAL_BRAND.phone ? "Ph " + REAL_BRAND.phone : ""].filter(Boolean).join(" · "),
  );
  return (
    `<div class="i3-nm">${from}</div>` +
    (addrLine ? `<div class="i3-ad">${addrLine}</div>` : "") +
    (REAL_BRAND.gstin ? `<div class="i3-gs">GSTIN ${esc(REAL_BRAND.gstin)}</div>` : "")
  );
}

export function permitBodyHtml(opts: {
  customerName: string;
  cft: number;
  pcs: number;
  date: string;
  fields: PermitFields;
}) {
  const name = esc(opts.customerName.trim() || "—");
  const from = esc(REAL_BRAND.name);
  const { fields } = opts;
  return (
    `<p>TO</p>` +
    `<p><u>The Range Forest Officer</u><br>Chitradurga.</p>` +
    `<p>Sub- Request for issuing of permit from ${from}, Chitradurga to <b>${name}</b>.</p>` +
    `<p>With reference to the above subject, the permit is to be issued in the name of <b>${name}</b>. ` +
    `Total CFT is <b>${qty(opts.cft, 2)}</b> and total pcs is <b>${qty(opts.pcs)}</b>. ` +
    `I have enclosed my old permit form no. <b>${esc(fields.form)}</b> dated <b>${esc(fields.oldDate)}</b>, ` +
    `leaf no. <b>${esc(fields.leaf)}</b> and book no. <b>${esc(fields.book)}</b>. Kindly issue the permit.</p>` +
    `<div class="permit-sign">` +
    `<div>Date-${esc(opts.date || "—")}<br>Place- Chitradurga</div>` +
    `<div class="permit-faith">Yours Faithfully</div>` +
    `</div>`
  );
}
