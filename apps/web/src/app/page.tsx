"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/shell/AppShell";
import { getToken } from "@/lib/auth";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
    }
  }, [router]);

  return <AppShell />;
}
