export function MetricPill({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "warn" }) {
  const toneClass = tone === "good"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
    : tone === "warn"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
      : "border-gray-800 bg-gray-900 text-gray-200";
  return (
    <div className={`rounded-lg border px-3 py-1.5 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

