export type ThemeId = "specora-dark" | "midnight" | "graphite" | "soft-light" | "high-contrast";

export type ThemeOption = {
  id: ThemeId;
  name: string;
  description: string;
  swatches: string[];
};

export const DEFAULT_THEME: ThemeId = "specora-dark";

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "specora-dark",
    name: "Specora Dark",
    description: "Balanced dark workspace with cyan action color.",
    swatches: ["#020617", "#111827", "#14b8c4"],
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Cooler blue-gray surfaces for low-light operations.",
    swatches: ["#020617", "#172033", "#60a5fa"],
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral charcoal surfaces with restrained contrast.",
    swatches: ["#050505", "#1c1c1f", "#a3e635"],
  },
  {
    id: "soft-light",
    name: "Soft Light",
    description: "Light neutral base with muted operational contrast.",
    swatches: ["#f4f2ed", "#e7e5dc", "#0f766e"],
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    description: "Sharper borders and brighter text for dense screens.",
    swatches: ["#000000", "#18181b", "#22d3ee"],
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_OPTIONS.some((theme) => theme.id === value);
}

export function applyTheme(theme: unknown) {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const resolved = isThemeId(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = "dark";
  return resolved;
}
