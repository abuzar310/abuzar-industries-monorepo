// White-label brand identity. Default is a neutral demo identity shown publicly
// and on every document; the owner can toggle to the real Abuzar branding.
import { metaGet, metaSet } from "./data";
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
  /** banks the user can pick from per invoice (the picker is not printed) */
  banks?: BankInfo[];
  /** invoice terms & conditions lines */
  terms?: string[];
  /** Google Maps review page — WhatsApp fallback if reviewFunnelUrl is unset */
  reviewUrl?: string;
  /**
   * Yard / flyer QR + WhatsApp "rate us" link — Abuzar review funnel.
   * `?go=1` skips the star gate → thank-you + copy → ~8s → Google Maps.
   */
  reviewFunnelUrl?: string;
}

const HDFC_BANK: BankInfo = { name: "HDFC Bank, Chitradurga", acName: "ABUZAR INDUSTRIES", ac: "50200006429458", ifsc: "HDFC0002566" };
const AXIS_BANK: BankInfo = { name: "AXIS Bank, Chitradurga", acName: "ABUZAR INDUSTRIES", ac: "921030054955694", ifsc: "UTIB0001019" };

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
  bank: HDFC_BANK,
  banks: [HDFC_BANK, AXIS_BANK],
  terms: INVOICE_TERMS,
  // Verified Google place URL — opens the business panel with Write a review
  reviewUrl:
    "https://www.google.com/maps/place/ABUZAR+INDUSTRIES/@14.2304243,76.3906535,17z/data=!4m8!3m7!1s0x3bba75de8a42ad97:0x9a8be15dab4a6208!8m2!3d14.2304243!4d76.3906535!9m1!1b1!16s%2Fg%2F11g3zdmpmp!5m2!1e4!1e2",
  reviewFunnelUrl: "https://abuzar-review.vercel.app/?go=1",
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
  // Same yard funnel — flyer QR must work on unofficial/demo brand too
  reviewFunnelUrl: "https://abuzar-review.vercel.app/?go=1",
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
