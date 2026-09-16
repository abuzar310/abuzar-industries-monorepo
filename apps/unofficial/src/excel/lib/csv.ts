// CSV in and out. Like Excel's own CSV, the file carries values, never formulas or formats.
import { plainValue, type UniCell, type UniSheet, type UniSnapshot, type UniStyle } from "./xlsx-convert";

/** Comma, semicolon or tab, whichever the first lines actually use; quotes honoured. */
export function parseCsv(text: string): string[][] {
  const s = String(text ?? "").replace(/^﻿/, "");
  const sample = s.slice(0, 4000);
  const commas = (sample.match(/,/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  const tabs = (sample.match(/\t/g) || []).length;
  const delim = tabs > commas && tabs > semis ? "\t" : semis > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** Rows → a one-sheet snapshot. Numeric-looking cells become numbers, everything else stays text. */
export function snapshotFromCsv(text: string): UniSnapshot {
  const rows = parseCsv(text);
  const cellData: Record<number, Record<number, UniCell>> = {};
  let maxCol = 0;
  rows.forEach((row, r) => {
    row.forEach((raw, c) => {
      const v = raw.trim();
      if (!v) return;
      (cellData[r] ??= {})[c] = NUMBER.test(v) ? { v: Number(v), t: 2 } : { v: raw, t: 1 };
      if (c > maxCol) maxCol = c;
    });
  });
  const sheet: UniSheet = {
    id: "sheet-01",
    name: "Sheet1",
    rowCount: Math.max(rows.length + 100, 200),
    columnCount: Math.max(maxCol + 26, 40),
    cellData,
    mergeData: [],
    columnData: {},
    rowData: {},
  };
  return { id: "", name: "", locale: "enUS", styles: {}, sheetOrder: [sheet.id], sheets: { [sheet.id]: sheet } };
}

const escape = (v: string) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

/** One sheet's values as CSV text: a formula cell contributes its result, like Excel's CSV. */
export function csvFromSheet(sheet: UniSheet, styles: Record<string, UniStyle | undefined>): string {
  void styles;
  let maxRow = -1;
  let maxCol = -1;
  for (const [rk, row] of Object.entries(sheet.cellData || {})) {
    for (const ck of Object.keys(row || {})) {
      const r = Number(rk);
      const c = Number(ck);
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    }
  }
  const lines: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const uni = sheet.cellData?.[r]?.[c];
      const v = uni ? plainValue(uni) : undefined;
      cells.push(v === undefined || v === null ? "" : escape(String(v)));
    }
    lines.push(cells.join(","));
  }
  return lines.join("\r\n");
}
