"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/shell/AppShell";
import { getToken } from "@/lib/auth";
import { BootstrapLoading } from "@/components/BootstrapLoading";

export default function HomePage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), 8000);
    if (!getToken()) {
      setAuthorized(false);
      router.replace("/login");
      window.clearTimeout(timer);
      return;
    }
    setAuthorized(true);
    window.clearTimeout(timer);
    return () => window.clearTimeout(timer);
  }, [router]);

  if (authorized !== true) {
    return <BootstrapLoading label="Loading Specora..." detail="Checking your local session." timedOut={timedOut} />;
  }

  return <AppShell />;
}
