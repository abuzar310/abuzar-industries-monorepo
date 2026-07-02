// White-label brand identity. Default is a neutral demo identity shown publicly
// and on every document; the owner can toggle to the real Abuzar branding.
import { metaGet, metaSet } from "./db";
import { getState, setBrandMode, type BrandMode } from "@/store/app-store";

export interface BankInfo {
  name: string;
  acName?: string;
  ac: string;
  ifsc: string;
}

export interface Brand {
  name: string;
  tagline: string;
  addr: string;
  phone: string;
  web: string;
  gstin: string;
  /** show the Abuzar logo image (real) vs a typographic wordmark (demo) */
  logo: boolean;
  /** invoice sub-heading, e.g. "IMPORTED SAW WOOD" */
  goods?: string;
  bank?: BankInfo;
  /** invoice terms & conditions lines */
  terms?: string[];
}

const INVOICE_TERMS = [
  "Goods once sold will not be taken back.",
  "Any type of cracks and damages — shop not responsible.",
  "Payment due on delivery unless agreed otherwise.",
  "All disputes subject to Chitradurga jurisdiction.",
];

export const REAL_BRAND: Brand = {
  name: "Abuzar Industries",
  tagline: "TIMBER",
  addr: "KSSIDC Industrial Area, DVG Road, Chitradurga, Karnataka – 577501",
  phone: "9845378626",
  web: "www.abuzarindustries.in",
  gstin: "29AROPA1101B1ZK",
  logo: true,
  goods: "",
  bank: { name: "AXIS Bank, Chitradurga", acName: "ABUZAR INDUSTRIES", ac: "921030054955694", ifsc: "UTIB0001019" },
  terms: INVOICE_TERMS,
};

export const DEMO_BRAND: Brand = {
  name: "Cut Size",
  tagline: "",
  addr: "",
  phone: "",
  web: "",
  gstin: "",
  logo: false,
  goods: "",
  bank: { name: "—", ac: "—", ifsc: "—" },
  terms: INVOICE_TERMS,
};

export const brandFor = (mode: BrandMode): Brand => (mode === "real" ? REAL_BRAND : DEMO_BRAND);

/** Active brand — readable from non-component code (PDF, WhatsApp, snapshot). */
export const activeBrand = (): Brand => brandFor(getState().brandMode);

export async function loadBrand(fallback: BrandMode = "demo") {
  const mode = await metaGet<BrandMode>("brandMode", fallback);
  setBrandMode(mode);
  return mode;
}

export async function saveBrandMode(mode: BrandMode) {
  setBrandMode(mode);
  await metaSet("brandMode", mode);
}
