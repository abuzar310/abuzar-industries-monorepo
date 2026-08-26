// Run: npx tsx packages/core/src/lib/party-search.check.ts
import { partyMatches } from "./party-search";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(partyMatches("", ["Ravi"]), "empty query matches");
ok(partyMatches("ravi", ["Ravi Kumar", "9876543210"]), "name token");
ok(partyMatches("RAVI ray", ["Ravi", "Rayadurga"]), "every word must hit");
ok(!partyMatches("ravi pune", ["Ravi", "Rayadurga"]), "missing token fails");
ok(partyMatches("98765", ["Ravi", "+91 98765 43210"]), "phone digits ignore spaces");
ok(partyMatches("9876543210", ["98765 43210"]), "full number vs spaced store");
ok(!partyMatches("12", ["9876543210"]), "1–2 digit tokens are not a phone match");
console.log(`party-search.check OK (${n} assertions)`);
