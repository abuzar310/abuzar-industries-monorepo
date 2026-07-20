"use client";
import { useApp } from "@/store/useApp";

export default function Toast() {
  const { toast } = useApp();
  return (
    <div id="toast" className={toast ? "show" : ""}>
      {toast}
    </div>
  );
}
