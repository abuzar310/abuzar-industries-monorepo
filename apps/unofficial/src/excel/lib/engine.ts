// Boot Univer. Phones get the official mobile UI plugins (inertia scroll, compact ribbon)
// plus the official sheets-mobile formula worker so flick frames are not fighting SUM.
//
// Source-checked (not README) — touch/scroll files only:
//   dream-num/univer MobileSheetsScrollRenderController — 5-sample weighted velocity,
//     rAF exponential decel, pinch; only free engine with real iOS flick.
//   rowsncolumns/grid useTouch.ts — Zynga Scroller, a grid not a workbook.
//   VisActor/VTable touch.ts + inertia.ts — 4-sample + rAF 0.95, a table.
//   TonyGermaneri/canvas-datagrid lib/touch.js — PPS + easing, a grid.
//   dream-num/Luckysheet mobile.js — fake scrollbar + setInterval 20ms.
//   ruilisi/fortune-sheet mobile.ts — raw delta, no inertia on touchend.
//   myliang/x-spreadsheet sheet.js bindTouch — raw delta.
//   wolf-table/table scroll.ts — index math, no touch.
// Stay on free Univer; swap only the UI plugins + worker on a phone.

import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import {
  UniverDocsPlugin,
  UniverDocsUIPlugin,
  UniverFormulaEnginePlugin,
  UniverMobileUIPlugin,
  UniverRenderEnginePlugin,
  UniverRPCMainThreadPlugin,
  UniverSheetsCorePreset,
  UniverSheetsFormulaPlugin,
  UniverSheetsFormulaUIPlugin,
  UniverSheetsMobileUIPlugin,
  UniverSheetsNumfmtPlugin,
  UniverSheetsNumfmtUIPlugin,
  UniverSheetsPlugin,
} from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";

export type SheetEngine = ReturnType<typeof createUniver> & { worker?: Worker };

const locales = { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) };

function slimDesktop(container: HTMLElement): SheetEngine {
  return createUniver({
    locale: LocaleType.EN_US,
    locales,
    presets: [
      UniverSheetsCorePreset({
        container,
        header: false,
        toolbar: true,
        formulaBar: true,
        statusBarStatistic: true,
      }),
    ],
  });
}

function spawnFormulaWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./formula.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

/** Same plugin order as dream-num/univer examples/src/sheets-mobile (v0.25.1), plus the formula worker. */
function mobile(container: HTMLElement, worker: Worker | null): SheetEngine {
  const offMain = !!worker;
  return createUniver({
    locale: LocaleType.EN_US,
    locales,
    presets: [
      {
        plugins: [
          [UniverFormulaEnginePlugin, { notExecuteFormula: offMain }],
          [UniverDocsPlugin, {}],
          UniverRenderEnginePlugin,
          [
            UniverMobileUIPlugin,
            {
              container,
              header: false,
              toolbar: true,
              ribbonType: "simple",
              disableAutoFocus: true,
            },
          ],
          ...(worker
            ? ([[UniverRPCMainThreadPlugin, { workerURL: worker }]] as [
                typeof UniverRPCMainThreadPlugin,
                { workerURL: Worker },
              ][])
            : []),
          UniverDocsUIPlugin,
          [UniverSheetsPlugin, { notExecuteFormula: offMain }],
          [
            UniverSheetsMobileUIPlugin,
            {
              formulaBar: false,
              footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: false },
              // Real Excel on a phone has no always-on desktop scrollbars. Flick
              // physics lives on the canvas; the bars only steal the gesture.
              scrollConfig: { enableHorizontal: false, enableVertical: false },
              disableAutoFocus: true,
            },
          ],
          UniverSheetsNumfmtPlugin,
          UniverSheetsNumfmtUIPlugin,
          [UniverSheetsFormulaPlugin, { notExecuteFormula: offMain }],
          UniverSheetsFormulaUIPlugin,
        ],
      },
    ],
  });
}

/** Phone → mobile plugins (inertia) + formula worker. Anything else → the usual desktop preset. */
export function startEngine(container: HTMLElement, phone: boolean): SheetEngine {
  if (!phone) return slimDesktop(container);
  const worker = spawnFormulaWorker();
  try {
    return { ...mobile(container, worker), worker: worker ?? undefined };
  } catch {
    worker?.terminate();
    return createUniver({
      locale: LocaleType.EN_US,
      locales,
      presets: [
        UniverSheetsCorePreset({
          container,
          header: false,
          toolbar: false,
          formulaBar: false,
          statusBarStatistic: false,
          footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: false },
          disableAutoFocus: true,
        }),
      ],
    });
  }
}
