// Run: npx tsx apps/unofficial/src/excel/lib/phone.check.ts
import { isPhone } from "./phone.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(isPhone(375, false), "a 375 phone is a phone");
ok(isPhone(1200, true), "a coarse pointer is a phone even when wide");
ok(!isPhone(1280, false), "a desktop mouse is not a phone");
ok(isPhone(760, false), "760 matches the rest of Cut Size");
ok(!isPhone(761, false), "761 is desktop");

console.log(`excel phone.check OK (${n} assertions)`);
