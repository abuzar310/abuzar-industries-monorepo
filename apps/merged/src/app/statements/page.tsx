import { redirect } from "next/navigation";

/** Statements tab renamed to Logs (owner-only activity trail). */
export default function Page() {
  redirect("/logs");
}
