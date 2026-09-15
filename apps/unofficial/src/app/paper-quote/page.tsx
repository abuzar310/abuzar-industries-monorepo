"use client";
import { useRouter } from "next/navigation";
import PaperScanner from "@/components/PaperScanner";
import { paperTargetQuote } from "@/lib/paper-client";

/** The old From paper link: open the scanner, then the quotation the lines go on. */
export default function Page() {
  const router = useRouter();
  return (
    <PaperScanner
      onPhoto={(file) => {
        void paperTargetQuote(file).then((id) => router.replace("/editor/" + id));
      }}
      onClose={() => {
        if (window.history.length > 1) router.back();
        else router.replace("/");
      }}
    />
  );
}
