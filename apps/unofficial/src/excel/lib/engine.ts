// Boot Univer. Phones get the official mobile UI plugins (inertia scroll, compact ribbon).
// Compared Luckysheet mobile.js, FortuneSheet mouse.ts, and x-spreadsheet bindTouch:
// those three still drag a fake scrollbar or apply a raw delta. Univer's
// MobileSheetsScrollRenderController is the one with iOS flick physics (velocity
// history + rAF). Stay on free Univer; swap only the UI plugins on a phone.

import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import {
  UniverDocsPlugin,
  UniverDocsUIPlugin,
  UniverFormulaEnginePlugin,
  UniverMobileUIPlugin,
  UniverRenderEnginePlugin,
  UniverSheetsCorePreset,
  UniverSheetsFormulaPlugin,
  UniverSheetsFormulaUIPlugin,
  UniverSheetsMobileUIPlugin,
  UniverSheetsNumfmtPlugin,
  UniverSheetsNumfmtUIPlugin,
  UniverSheetsPlugin,
} from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";

export type SheetEngine = ReturnType<typeof createUniver>;

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

/** Same plugin order as dream-num/univer examples/src/sheets-mobile (v0.25.1). */
function mobile(container: HTMLElement): SheetEngine {
  return createUniver({
    locale: LocaleType.EN_US,
    locales,
    presets: [
      {
        plugins: [
          [UniverFormulaEnginePlugin, {}],
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
          UniverDocsUIPlugin,
          [UniverSheetsPlugin, {}],
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
          [UniverSheetsFormulaPlugin, {}],
          UniverSheetsFormulaUIPlugin,
        ],
      },
    ],
  });
}

/** Phone → mobile plugins (inertia). Anything else → the usual desktop preset. */
export function startEngine(container: HTMLElement, phone: boolean): SheetEngine {
  if (!phone) return slimDesktop(container);
  try {
    return mobile(container);
  } catch {
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
