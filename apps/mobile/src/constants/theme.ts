import { Platform } from "react-native";

export const colors = {
  canvas: "#070B16",
  surface: "#141D2E",
  surfaceRaised: "#1B2639",
  border: "#29384F",
  text: "#F6F8FC",
  textMuted: "#A8B3C7",
  brand: "#7C3AED",
  brandBright: "#A855F7",
  community: "#55B6F6",
  success: "#4ADE80",
  danger: "#FB7185",
  warning: "#FBBF24",
  overlay: "rgba(7, 11, 22, 0.72)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  hero: 48,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export const typography = {
  display: Platform.select({ ios: "Avenir Next", default: "sans-serif" }),
  body: Platform.select({ ios: "System", default: "sans-serif" }),
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
} as const;
