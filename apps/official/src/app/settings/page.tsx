"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import SettingsView from "@/components/views/SettingsView";

export default function Page() {
  const { ready, user } = useApp();
  const router = useRouter();
  const isOwner = user?.role === "owner";

  useEffect(() => {
    if (ready && user && !isOwner) {
      toast("Only the owner can open Settings");
      router.replace("/");
    }
  }, [ready, user, isOwner, router]);

  if (!isOwner) {
    return (
      <div className="sectitle">
        Settings <small>— owner only</small>
      </div>
    );
  }
  return <SettingsView />;
}
