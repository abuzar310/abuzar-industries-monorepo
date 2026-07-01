# GOAL — split into two deployments

Turn the current single app into **two separate products / two deployments**, sharing one
core so we don't maintain the same quotation/customer/sync code twice.

- **App A — "Unofficial"** (Ajju's daily cash-business app): Quotations + Customers + a
  reworked session-based **Daybook**. **No invoices, no ledger.** Woody, keyboard-first UI.
- **App B — "Abuzar Industries" (official)**: Quotations → **Invoices** (auto + custom) +
  a **Stock / Trading account**. **No daybook, no ledger.** Beautiful watermarked invoice.

Reference images (from the owner): `reference/invoice-refs/official-invoice.png` (paper
invoice layout), `reference/invoice-refs/trading-stock-sheet.png` (Excel trading account).

---

## Architecture — monorepo (DONE ✅ Phase 0)

```
packages/core/src  shared: lib (db, cloud, calc, types, doc, numbering, customers,
                   ledger, expenses, pdf, whatsapp, brand, constants…), store,
                   components (editor, views, TopNav/Toast/LoginGate/DialogHost), globals.css
apps/unofficial    Next app → / editor quotations customers expenses(daybook) settings
apps/official      Next app → / editor quotations invoices customers stock settings
```

- **Shared source, not a published package.** Each app's `tsconfig` maps `@/*` →
  `["./src/*", "../../packages/core/src/*"]`, so existing `@/…` imports resolve to core with
  **zero import rewrites**. Turbopack resolves it because the repo-root `pnpm-lock.yaml` sets the
  workspace root above both `apps/` and `packages/`.
- **Per-app nav:** each app has `src/app-config.ts` exporting its own `TABS`; the app `layout`
  passes them into the shared `AppProvider → TopNav` (which now takes a `tabs` prop). This is
  the feature gate — routes that don't exist in an app simply aren't created.
- Single root `node_modules` / `package.json` (no per-app installs). Apps run via
  `next dev/build apps/<name>`.

### Run commands
```
pnpm dev            # unofficial on :3010 (alias of dev:unofficial)
pnpm dev:official   # official on :3020
pnpm build:unofficial   /   pnpm build:official
pnpm typecheck      # whole-repo tsc
pnpm check          # ledger + calc self-checks
pnpm lint
```

> Pre-existing lint issues remain in `Editor.tsx`, `SettingsView.tsx`, `DialogHost.tsx`
> (setState-in-effect / use-before-declare) — carried over from the original code, not the split.
> Clean up during the App-A/App-B UI passes.

---

## App A — "Unofficial" (Ajju's app)

### Keep / drop
- **Keep:** Quotation editor, Quotations list, Customers.
- **Drop:** Invoices, Ledger (both removed from nav + routes).

### Quotation UI (make it clean + keyboard-first)
- Woody theme polish on the quotation screen.
- **Prominent, obvious "Create quotation" button.**
- Fix the quotations list/editor: current buttons + status ("what's been done") are unclear —
  make actions and state legible.
- **Full keyboard operation** of the quotation editor (tab order, enter-to-next-row,
  shortcuts to add row/section, save) — data entry should never need the mouse.

### Daybook — full rework (the core of App A)
Purpose: Ajju records the day's money; Afsar just views a clean summary.

- **Quotation → payment split:** on a quotation capture **Cash paid** vs **UPI paid**.
  When cash is taken, **auto-create today's Daybook entry** (cash in, from this sale, with the
  customer name) — "today you got ₹X from <customer>".
- **Clean entry UI** for manual records (current one is broken/unfriendly).
- **Day sessions:**
  - A running **"Today" session** accumulates sales (e.g. +40k) and lets Ajju log expenses
    (e.g. −2k for extras); it shows a live **net for today**.
  - A **"cleared / given to Afsar" amount** line: when Ajju hands the cash over, he records the
    given amount and **closes the day** → that session is archived (stored, viewable later) and
    a **fresh session** starts.
  - Old sessions are always kept and browsable.
- **Roles:** Ajju = enter/manage; Afsar = clean read-only view (day summaries + history).

> Decisions needed: (a) app/deploy name for the "unofficial" one; (b) exact fields Afsar
> should see per closed day (net, given, short/over?); (c) do expenses need categories or just
> amount + note.

---

## App B — "Abuzar Industries" (official)

### Keep / drop
- **Keep:** Quotation + Quotations.
- **Add:** Invoices — **auto-create from a quotation** (clean one-click) **and** a separate
  **"Create custom invoice"** path (invoice without a prior quotation).
- **Drop:** Daybook, Ledger.

### Invoice design (from `official-invoice.png`)
Keep every core field, make it beautiful, add a strong **wood watermark**:
- Header: **ABUZAR INDUSTRIES**, KSSIDC Industrial Area, DVG Road, Chitradurga, Karnataka.
- Party: Customer name, Address, **Mobile No**, **GSTIN No**, Payment type, Invoice No + Date,
  "IMPORTED SAW WOOD".
- Line table: **S.No · Description of goods · L · F · T · CFT · Rate · Taxable Amount ·
  SGST 9% · CGST 9% · Total Amount** (18% GST shown split as SGST 9% + CGST 9%).
- Totals: Taxable, SGST, CGST, Grand total (₹ in words too, already supported).
- Footer: **HDFC Bank, Chitradurga — A/c No + IFSC**; **For Abuzar Industries / Proprietor /
  Account Signature**; **Customer Signature**; "Thank you note for your business".
- Terms: "Goods once sold will not be taken back"; "Any type of cracks and damages shop not
  responsible".
- **Woodmark watermark** behind the content.

> Note: current invoices compute a single GST %. Need to render it as **SGST 9% + CGST 9%**
> (and confirm whether inter-state **IGST 18%** is ever needed).

### Stock / Trading account (from `trading-stock-sheet.png`)
A running stock position, updated by invoices:
- **Opening balance:** total stored **value (₹)** + total **CFT**.
- **Purchase (buying) invoice** → increases stock (value + CFT).
- **Sale (selling) invoice** → decreases stock (value + CFT), records sale value + GST.
- **Closing stock today:** value + CFT, shown per day; plus **Gross Profit**, **Avg Rate**
  (value ÷ CFT), and the month-wise Purchase vs Sell summary from the sheet.

> Decisions needed: (a) is per-species stock (Teak/Neem/…) needed or one pooled CFT position;
> (b) does a "buying invoice" use the same template as a selling invoice; (c) confirm the exact
> Trading-account boxes to reproduce (Opening/Purchase/GP/Total/Sell/Closing + CFT + Avg Rate).

---

## Suggested phasing
0. **Split scaffold** — ✅ DONE. Monorepo: `packages/core` + `apps/unofficial` + `apps/official`.
1. **App A** — ✅ DONE. Per-app `features` config (`invoices`/`simpleQuote`/`acceptPayment`).
   Editor: single-source Draft/Create (simpleQuote), accept-payment (cash/UPI) → daybook.
   Daybook reworked into **sessions**: current session → "Give ₹X to Afsar & close" archives it
   to a `sessions` store and starts fresh; Session History below; owner (Afsar) sees a read-only view.
   Quotation list clarified (row-click + labelled Open/Print/WhatsApp). PDF fixed (direct html2canvas);
   Print is primary, Download PDF in More.
2. **App B** — ✅ DONE. Invoice = Tax/Purchase invoice with SGST 9% + CGST 9% split, Abuzar header
   (addr/GSTIN/IMPORTED SAW WOOD), bank + signatures + 4 terms + thank-you, wood wordmark watermark,
   fills A4 on print. Quotation→Invoice (Convert) + custom invoice (Invoices list / +Invoice). Sell/Buy
   toggle on invoices. Editing an invoice highlights the Invoices tab (not Quotation).

### Trading account model (`trading-calc.ts`, matches the owner's Excel)
Opening (value + CFT) + Purchases → **available**. `Avg Rate = availValue / availCft`.
`Closing CFT` = physical count if entered, else auto = available − sold. `Closing value = closingCft × avgRate`.
`COGS = availValue − closingValue`. `Gross Profit = saleValue − COGS`. `Total Amount = availValue + GP`.
Verified against the sheet: Avg 907.48 = Closing 69,14,923 ÷ CFT 7,619.94. Month-wise table mirrors
Karnataka·GST·Total P.K / Sell·Sell GST·Total Sell. A **sale invoice auto-reduces closing stock**.
> Confirm with owner: exact HDFC A/c No + IFSC (placeholder "—" in `brand.ts`); whether the FIRE WOOD
> (no-GST) category needs its own column.

Do one phase at a time; confirm each before the next.

## Open decisions to confirm before building
1. Monorepo split (recommended) vs two separate copied folders?
2. Which app first — A (Ajju daybook) or B (official invoice + stock)?
3. Name/branding for the "unofficial" app.
4. Feature clarifications flagged inline above (daybook Afsar view, SGST/CGST vs IGST,
   per-species vs pooled stock).
