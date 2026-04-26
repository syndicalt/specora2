"use client";

import { useEffect, useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import { Database, MessageSquare, Sparkles } from "lucide-react";

type SampleCI = {
  id: string;
  name: string;
  class: string;
  environment?: string;
};

export default function HelloWorldApp({ shell }: { shell: ShellAPI }) {
  const [cis, setCis] = useState<SampleCI[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    shell.query(`query { cis(limit: 5) { id name class environment } }`)
      .then((data: any) => {
        if (!cancelled) setCis(data.cis || []);
      })
      .catch(() => {
        shell.notify("Hello World could not read CMDB sample data", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [shell]);

  return (
    <div className="flex h-full w-full flex-col bg-gray-950 text-gray-100">
      <header className="flex items-center gap-3 border-b border-gray-800 px-6 py-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Hello World</h1>
          <p className="text-sm text-gray-500">A local marketplace demo app running inside the Specora shell.</p>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-[1fr_320px] gap-6 overflow-auto p-6">
        <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
            <Database className="h-4 w-4 text-indigo-300" />
            CMDB Sample
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-950 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-left">Environment</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} className="px-3 py-8 text-center text-gray-500">Loading...</td></tr>
                ) : cis.map((ci) => (
                  <tr key={ci.id} className="border-t border-gray-800">
                    <td className="px-3 py-2 font-medium text-gray-200">{ci.name}</td>
                    <td className="px-3 py-2 text-gray-400">{ci.class}</td>
                    <td className="px-3 py-2 text-gray-400">{ci.environment || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-lg border border-gray-800 bg-gray-900/60 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
            <MessageSquare className="h-4 w-4 text-indigo-300" />
            Shell API
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            This app is installed through the marketplace seed, but loaded from the native shell so it works offline and in local development.
          </p>
          <button
            onClick={() => shell.notify("Hello from the installed demo app", "success")}
            className="mt-4 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Send Notification
          </button>
        </aside>
      </main>
    </div>
  );
}
