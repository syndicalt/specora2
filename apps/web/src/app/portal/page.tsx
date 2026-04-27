"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/shell/AppShell";
import { getToken } from "@/lib/auth";

export default function PortalPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setAuthorized(false);
      router.replace("/login");
      return;
    }
    setAuthorized(true);
  }, [router]);

  if (authorized !== true) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-950 text-sm text-gray-500">
        Loading Specora...
      </div>
    );
  }

  return <AppShell initialAppId="customer-portal" />;
}
