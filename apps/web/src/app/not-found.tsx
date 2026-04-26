import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 p-6 text-gray-100">
      <section className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-gray-400">The requested Specora route does not exist.</p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
        >
          Open Specora
        </Link>
      </section>
    </main>
  );
}
