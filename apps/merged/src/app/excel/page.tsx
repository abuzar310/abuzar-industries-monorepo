"use client";
import dynamic from "next/dynamic";

// The spreadsheet engine draws on canvas and needs the browser, so it never renders on the server.
// Relative import: "@/…" resolves into this app first and then packages/core, and the sheet is
// neither — it lives beside the app's routes and keeps its workbooks on the device.
const SheetApp = dynamic(() => import("../../excel/components/SheetApp"), { ssr: false });

export default function Page() {
  return <SheetApp />;
}
