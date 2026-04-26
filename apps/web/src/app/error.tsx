"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-gray-100">
      <section className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h1 className="text-lg font-semibold">Specora could not load</h1>
        <p className="mt-2 text-sm text-gray-400">The shell hit a recoverable rendering error.</p>
        <button
          onClick={reset}
          className="mt-5 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
        >
          Reload
        </button>
      </section>
    </main>
  );
}
