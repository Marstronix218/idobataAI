export const AVATAR_OPTIONS = [
  { value: "/avatars/acorn.png", label: "Acorn avatar" },
  { value: "/avatars/moon.png", label: "Moon avatar" },
  { value: "/avatars/sprout.png", label: "Sprout avatar" },
  { value: "/avatars/cloud.png", label: "Cloud avatar" },
] as const;

export type AvatarPath = (typeof AVATAR_OPTIONS)[number]["value"];

export const AVATAR_PATHS = AVATAR_OPTIONS.map(({ value }) => value) as readonly AvatarPath[];
