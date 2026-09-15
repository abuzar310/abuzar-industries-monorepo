"use client";
import { useRouter } from "next/navigation";
import { getFeatures } from "@/lib/features";
import { personCardHref, personOf, readPeople, type PersonStore } from "@/lib/people";
import { useApp } from "@/store/useApp";

/** "Person card" on a customer, carpenter or rent page. The number shows how many records share the card. */
export default function PersonCardButton({
  store,
  id,
  className = "btn sm",
}: {
  store: PersonStore;
  id: string;
  className?: string;
}) {
  useApp(); // re-read the cards whenever the books or shared settings change
  const router = useRouter();
  if (!getFeatures().carpenters) return null;
  const people = readPeople();
  const link = { store, id };
  const person = personOf(people, link);
  return (
    <button type="button" className={className} onClick={() => router.push(personCardHref(link, people))}>
      Person card{person ? " · " + person.links.length : ""}
    </button>
  );
}
