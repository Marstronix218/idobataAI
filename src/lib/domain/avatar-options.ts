export const AVATAR_OPTIONS = [
  { value: "/avatars/kuro.png", label: "Kuro" },
  { value: "/avatars/mika.png", label: "Mika" },
  { value: "/avatars/riku.png", label: "Riku" },
  { value: "/avatars/suzu.png", label: "Suzu" },
] as const;

export type AvatarPath = (typeof AVATAR_OPTIONS)[number]["value"];

export const AVATAR_PATHS = AVATAR_OPTIONS.map(({ value }) => value) as readonly AvatarPath[];
