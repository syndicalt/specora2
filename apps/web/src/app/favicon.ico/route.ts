export const dynamic = "force-static";

export function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#020617"/><path d="M17 36c7-17 23-17 30 0" fill="none" stroke="#22d3ee" stroke-width="6" stroke-linecap="round"/><circle cx="24" cy="38" r="5" fill="#818cf8"/><circle cx="40" cy="38" r="5" fill="#34d399"/></svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
