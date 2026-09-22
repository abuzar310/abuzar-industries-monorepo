// The pure half of autosave: which engine commands mean the workbook changed, and the
// debounce that turns a burst of edits into one save.

// Moving the selection, scrolling or zooming changes nothing worth saving.
const SKIP = [/set-selection/, /set-activate/, /scroll/, /zoom/, /viewport/, /marquee/, /hover/, /pointer/, /highlight/, /sidebar/, /focus/];

export function shouldAutosave(commandId: string): boolean {
  if (!commandId) return false;
  return !SKIP.some((r) => r.test(commandId));
}

export type Debounced = { kick: () => void; flush: () => void; cancel: () => void };

/** kick() restarts the wait; flush() runs a pending save at once; cancel() drops it. */
export function makeDebounce(run: () => void, ms: number): Debounced {
  let t: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (t !== null) {
      clearTimeout(t);
      t = null;
    }
  };
  return {
    kick() {
      cancel();
      t = setTimeout(() => {
        t = null;
        run();
      }, ms);
    },
    flush() {
      if (t !== null) {
        cancel();
        run();
      }
    },
    cancel,
  };
}
