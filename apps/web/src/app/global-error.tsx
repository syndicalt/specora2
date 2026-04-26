"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100">
        <main className="flex min-h-screen items-center justify-center p-6">
          <section className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h1 className="text-lg font-semibold">Specora could not start</h1>
            <p className="mt-2 text-sm text-gray-400">The application shell failed before the page could render.</p>
            <button
              onClick={reset}
              className="mt-5 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
