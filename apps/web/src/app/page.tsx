"use client";

import { useEffect } from "react";
import { AppShell } from "@/shell/AppShell";
import { ChatOverlay } from "@/components/ChatOverlay";
import { getToken } from "@/lib/auth";

export default function HomePage() {
  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
    }
  }, []);

  return (
    <>
      <AppShell />
      <ChatOverlay />
    </>
  );
}
