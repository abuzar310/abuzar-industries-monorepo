import { getFeatures } from "./features";
import type { Section } from "./types";

/** Suggestions for the wood-type picker (official + cut-size). */
export const WOOD_TYPES = [
  "Imported Teak Wood",
  "Teak",
  "White Teak",
  "Nagpur Teak",
  "CP Teak",
  "Ghana Teak",
  "Honne",
  "Neem",
  "Sagwan",
  "Rosewood",
] as const;

/** Official default wood name (invoices + quotations). */
export const OFFICIAL_DEFAULT_WOOD = "Imported Teak Wood";

/** First wood box on a brand-new quotation / invoice. */
export function defaultWoodSection(): Section {
  const official = !getFeatures().simpleQuote;
  return {
    name: official ? OFFICIAL_DEFAULT_WOOD : "Teak",
    rate: 4000,
    rows: [{ l: "", w: "", t: "", pcs: "" }],
  };
}
