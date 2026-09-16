import { Suspense } from "react";
import PurchaseCheckView from "@/components/views/PurchaseCheckView";

// The screen reads the folder and sheet from the address, so it needs a Suspense boundary to build.
export default function Page() {
  return (
    <Suspense>
      <PurchaseCheckView />
    </Suspense>
  );
}
