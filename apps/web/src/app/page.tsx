"use client";

import { useEffect } from "react";
import { GraphExplorer } from "@/components/GraphExplorer";
import { ChatOverlay } from "@/components/ChatOverlay";
import { getToken } from "@/lib/auth";

export default function HomePage() {
  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
    }
  }, []);

  return (
    <main className="h-screen w-screen relative overflow-hidden">
      <GraphExplorer />
      <ChatOverlay />
    </main>
  );
}
