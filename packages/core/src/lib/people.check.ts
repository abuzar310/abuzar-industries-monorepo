// Run: npx tsx packages/core/src/lib/people.check.ts
import {
  cleanPeople,
  parsePersonRef,
  personCardHref,
  personSuggestions,
  withLink,
  withoutLink,
  type PersonLink,
} from "./people";
import type { Carpenter, Customer } from "./types";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const cu = (id: string): PersonLink => ({ store: "customers", id });
const ca = (id: string): PersonLink => ({ store: "carpenters", id });

// linking
const start = withLink([], cu("C1"), ca("K1"), "P1", "t");
ok(start.people.length === 1 && start.person?.id === "P1" && start.person.links.length === 2, "two records start a card");
const three = withLink(start.people, ca("K1"), cu("C2"), "P2", "t");
ok(three.people.length === 1 && three.person?.id === "P1" && three.person.links.length === 3, "a third record joins the same card");
ok(withLink(three.people, cu("C1"), cu("C2"), "P3", "t").people === three.people, "records already together: no change");
ok(withLink(three.people, cu("C1"), cu("C1"), "P3", "t").people === three.people, "a record with itself: no change");
const other = withLink(three.people, cu("C9"), ca("K9"), "P9", "t");
ok(other.people.length === 2, "a different pair starts its own card");
const merged = withLink(other.people, cu("C2"), ca("K9"), "PX", "t");
ok(merged.people.length === 1 && merged.person?.id === "P1" && merged.person.links.length === 5, "two cards join into the first");

// unlinking
const fewer = withoutLink(merged.people, ca("K9"));
ok(fewer.length === 1 && fewer[0].links.length === 4, "unlink takes one record off");
ok(withoutLink(start.people, cu("C1")).length === 0, "a card left with one record goes away");
ok(withoutLink(merged.people, cu("nobody")) .length === 1, "unlinking a record on no card changes nothing");

// the saved setting
ok(cleanPeople(null).length === 0 && cleanPeople("x").length === 0 && cleanPeople({}).length === 0, "a bad setting reads as no cards");
ok(cleanPeople([{ id: "P", links: [cu("A"), { store: "quotations", id: "Q" }, ca("B")] }])[0].links.length === 2, "unknown stores dropped");
ok(cleanPeople([{ id: "P", links: [cu("A"), { store: "customers", id: "" }] }]).length === 0, "a card needs two real records");
ok(cleanPeople([null, 5, { links: [cu("A"), ca("B")] }]).length === 0, "rows without an id dropped");

// addresses
ok(personCardHref(cu("C1"), merged.people) === "/people/P1", "a linked record opens its person");
ok(personCardHref(cu("Z"), merged.people) === "/people/customers%3AZ", "a record on no card opens on its own");
ok(parsePersonRef("customers:CUST-1").link?.store === "customers" && parsePersonRef("customers:CUST-1").link?.id === "CUST-1", "record address");
ok(parsePersonRef("carpenters:CARP-1").link?.store === "carpenters", "carpenter address");
ok(parsePersonRef("PER-abc").personId === "PER-abc" && !parsePersonRef("PER-abc").link, "person address");
ok(parsePersonRef("quotations:Q1").personId === "quotations:Q1", "other stores are not records");

// suggestions
const customers = [
  { id: "C1", name: "ISMAIL", phone: "+91 98450 12345" },
  { id: "C2", name: "Raju", phone: "" },
  { id: "C3", name: " ismail ", phone: "" },
  { id: "C4", name: "SURESH PLYNING", phone: "" },
] as Customer[];
const carpenters = [
  { id: "K1", name: "ISMAIL PLYNING WORK", phone: "9845012345" },
  { id: "K2", name: "Raju", phone: "123" },
  { id: "K3", name: "SURESHA PLANNING", phone: "", phoneAlt: "" },
  { id: "K4", name: "Mahanthesh", phone: "080 4000 1234", phoneAlt: "98450 12345" },
] as Carpenter[];
const forIsmail = personSuggestions([cu("C1")], customers, carpenters).map((l) => l.id);
ok(forIsmail.includes("K1"), "the same last 10 digits suggests the carpenter card");
ok(forIsmail.includes("K4"), "a matching second number counts too");
ok(forIsmail.includes("C3"), "the same name suggests the other customer row");
ok(!forIsmail.includes("C1"), "never suggests a record already on the card");
ok(!forIsmail.includes("C2") && !forIsmail.includes("K2") && !forIsmail.includes("K3"), "other people stay out");
const forRaju = personSuggestions([cu("C2")], customers, carpenters).map((l) => l.id);
ok(forRaju.length === 1 && forRaju[0] === "K2", "a short or empty phone never matches; the name does");
const forSuresha = personSuggestions([ca("K3")], customers, carpenters).map((l) => l.id);
ok(forSuresha.length === 1 && forSuresha[0] === "C4", "Suresh and Suresha shop names suggest each other");
ok(personSuggestions([], customers, carpenters).length === 0, "an empty card suggests nothing");

console.log(`people.check OK (${n} assertions)`);
