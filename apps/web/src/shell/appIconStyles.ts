import type { CSSProperties } from "react";

export const DEFAULT_APP_ICON_COLOR = "#818cf8";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHexColor(color?: string | null) {
  if (!color || !HEX_COLOR.test(color.trim())) return DEFAULT_APP_ICON_COLOR;
  const value = color.trim();
  if (value.length === 7) return value.toLowerCase();
  return `#${value.slice(1).split("").map((char) => char + char).join("")}`.toLowerCase();
}

function hexToRgb(hex: string) {
  const normalized = normalizeHexColor(hex);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

type AppIconColorSource = {
  iconColor?: string | null;
};

export function appIconColor(entry: AppIconColorSource) {
  return normalizeHexColor(entry.iconColor);
}

export function appIconTileStyle(entry: AppIconColorSource, options: { active?: boolean; elevated?: boolean } = {}): CSSProperties {
  const color = appIconColor(entry);
  const { r, g, b } = hexToRgb(color);
  const backgroundAlpha = options.active ? 0.22 : 0.12;
  const borderAlpha = options.active ? 0.42 : 0.22;
  const shadowAlpha = options.elevated ? 0.28 : 0.16;

  return {
    color,
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${backgroundAlpha})`,
    borderColor: `rgba(${r}, ${g}, ${b}, ${borderAlpha})`,
    boxShadow: `0 0 20px rgba(${r}, ${g}, ${b}, ${shadowAlpha})`,
  };
}
