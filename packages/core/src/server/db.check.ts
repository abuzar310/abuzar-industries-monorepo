// Self-check: which Postgres errors we retry vs rethrow.
// Run: npx tsx packages/core/src/server/db.check.ts
import { isTransientPgError } from "./db";

let n = 0;
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
  n++;
}

ok(isTransientPgError(Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" })), "dead socket");
ok(isTransientPgError({ message: "SSL connection has been closed unexpectedly", code: "08006" }), "ssl drop");
ok(isTransientPgError({ message: "sorry, too many clients already", code: "53300" }), "pool full");
ok(isTransientPgError({ message: "timeout expired", code: "ETIMEDOUT" }), "connect timeout");
ok(!isTransientPgError(new Error("column foo does not exist")), "SQL error is not retried");
ok(!isTransientPgError(new Error("duplicate key value violates unique constraint")), "conflict is not retried");

console.log(`db.check OK (${n} assertions)`);
