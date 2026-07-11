import type { Section } from "./types";

export const CO = {
  name: "Abuzar Industries",
  addr: "KSSIDC Industrial Area, DVG Road, Chitradurga, Karnataka – 577501",
  phone: "9845378626",
  web: "www.abuzarindustries.in",
  gstin: "29AROPA1101B1ZK",
} as const;

export const STATUSES = [
  "Draft",
  "Sent",
  "Follow-up Pending",
  "Confirmed",
  "Rejected",
  "Converted to Invoice",
] as const;

export const SAMPLE_SECTIONS: Section[] = [
  {
    name: "Teak",
    rate: 3600,
    rows: [
      { l: 7, w: 6, t: 4, pcs: 3 },
      { l: 6, w: 6, t: 4, pcs: 2 },
      { l: 4, w: 6, t: 4, pcs: 1 },
      { l: 7, w: 6, t: 3, pcs: 2 },
      { l: 4, w: 6, t: 3, pcs: 2 },
      { l: 7, w: 5, t: 3, pcs: 2 },
      { l: 4, w: 5, t: 3, pcs: 2 },
    ],
  },
  {
    name: "Neem",
    rate: 900,
    rows: [
      { l: 7, w: 5, t: 3, pcs: 6 },
      { l: 5, w: 5, t: 3, pcs: 4 },
      { l: 6, w: 5, t: 3, pcs: 4 },
      { l: 4, w: 5, t: 3, pcs: 19 },
      { l: 3, w: 5, t: 3, pcs: 4 },
      { l: 2, w: 5, t: 3, pcs: 6 },
    ],
  },
];
