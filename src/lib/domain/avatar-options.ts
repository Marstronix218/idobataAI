export const AVATAR_OPTIONS = [
  { value: "/avatars/acorn.png", label: "Acorn" },
  { value: "/avatars/moon.png", label: "Moon" },
  { value: "/avatars/sprout.png", label: "Sprout" },
  { value: "/avatars/cloud.png", label: "Cloud" },
] as const;

export type AvatarPath = (typeof AVATAR_OPTIONS)[number]["value"];

export const AVATAR_PATHS = AVATAR_OPTIONS.map(({ value }) => value) as readonly AvatarPath[];
