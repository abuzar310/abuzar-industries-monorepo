// Formula math off the UI thread. Same worker preset the official
// dream-num/univer examples/src/sheets-mobile (v0.25.1) boots — without it
// every flick frame shares the main thread with SUM/IF.
import { LocaleType, Univer } from "@univerjs/presets";
import { UniverSheetsCoreWorkerPreset } from "@univerjs/preset-sheets-core/worker";

const univer = new Univer({ locale: LocaleType.EN_US });
for (const item of UniverSheetsCoreWorkerPreset().plugins) {
  const [plugin, options] = Array.isArray(item) ? item : [item];
  univer.registerPlugin(plugin, options);
}
