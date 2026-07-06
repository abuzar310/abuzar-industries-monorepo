// GSTIN validation + lookup (client-safe helpers).
// Offline: format + checksum + state code. Online: verifyGstin() hits the
// server route (/api/gst) which proxies a GST verification provider so the
// API key never reaches the browser.

/** Normalised result of a GSTIN lookup, whatever the provider. */
export interface GstInfo {
  gstin: string;
  /** legal (registered) name of the taxpayer. */
  legalName?: string;
  /** trade name, if different from the legal name. */
  tradeName?: string;
  /** raw status string from the provider, e.g. "Active", "Cancelled". */
  status?: string;
  /** true when the registration is currently active. */
  active: boolean;
  /** principal place of business, flattened to one line. */
  address?: string;
  /** taxpayer type, e.g. "Regular", "Composition". */
  taxpayerType?: string;
  /** constitution of business, e.g. "Proprietorship". */
  constitution?: string;
  /** registration date, as returned by the provider (dd/mm/yyyy). */
  registrationDate?: string;
  /** derived state name from the first two GSTIN digits. */
  state?: string;
  /** true when the provider returned sample/sandbox data (e.g. Appyflow free
   *  credits) — the details are NOT real and must not be trusted. */
  sandbox?: boolean;
}

export type GstLookup =
  | { ok: true; info: GstInfo }
  | { ok: false; error: string };

const CODEPOINTS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// state code (first two GSTIN digits) → state / UT name.
const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli",
  "27": "Maharashtra", "28": "Andhra Pradesh (Old)", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

/** Uppercase + strip spaces from a typed GSTIN. */
export function cleanGstin(raw: string): string {
  return (raw || "").toUpperCase().replace(/\s+/g, "");
}

/** Structural pattern: 2 digits, 5 letters, 4 digits, 1 letter, 1 alnum, 'Z', 1 alnum. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** Verify the 15th character (mod-36 check digit over the first 14). */
function checkDigit(first14: string): string {
  let factor = 2;
  let sum = 0;
  const mod = CODEPOINTS.length; // 36
  for (let i = first14.length - 1; i >= 0; i--) {
    const code = CODEPOINTS.indexOf(first14[i]);
    if (code < 0) return "";
    let digit = factor * code;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / mod) + (digit % mod);
    sum += digit;
  }
  return CODEPOINTS[(mod - (sum % mod)) % mod];
}

/** True when the GSTIN passes both the pattern and the checksum (offline). */
export function isValidGstinFormat(raw: string): boolean {
  const g = cleanGstin(raw);
  if (!GSTIN_RE.test(g)) return false;
  return checkDigit(g.slice(0, 14)) === g[14];
}

/** State / UT name from the leading two digits, or undefined. */
export function stateFromGstin(raw: string): string | undefined {
  const g = cleanGstin(raw);
  return STATE_CODES[g.slice(0, 2)];
}

/** Look up a GSTIN via the server route. Never throws; returns a tagged result. */
export async function verifyGstin(raw: string): Promise<GstLookup> {
  const gstin = cleanGstin(raw);
  if (!isValidGstinFormat(gstin)) {
    return { ok: false, error: "Not a valid GSTIN (check the number)." };
  }
  try {
    const res = await fetch(`/api/gst?gstin=${encodeURIComponent(gstin)}`);
    const data = (await res.json().catch(() => null)) as GstLookup | null;
    if (!data) return { ok: false, error: `Lookup failed (${res.status}).` };
    return data;
  } catch {
    return { ok: false, error: "Network error — could not reach the lookup service." };
  }
}
