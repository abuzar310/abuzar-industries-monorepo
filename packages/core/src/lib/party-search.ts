/** On-page party search: every word must hit, and phone digits match across spaces / +91. */

export function partyNeedle(q: string): string {
  return (q || "").trim().toLowerCase();
}

export function partyMatches(q: string, fields: Array<string | number | undefined | null>): boolean {
  const raw = partyNeedle(q);
  if (!raw) return true;
  const tokens = raw.split(/\s+/).filter(Boolean);
  const text = fields.map((v) => String(v ?? "").toLowerCase()).join(" ");
  const digitsHay = fields.map((v) => String(v ?? "").replace(/\D+/g, "")).filter(Boolean).join(" ");
  return tokens.every((t) => {
    if (text.includes(t)) return true;
    const d = t.replace(/\D+/g, "");
    return d.length >= 3 && digitsHay.includes(d);
  });
}
