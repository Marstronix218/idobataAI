"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

type AvatarProps = {
  initials: string;
  avatarUrl?: string | null;
  name?: string;
  ai?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  color?: string;
};

export function Avatar({ initials, avatarUrl, name, ai = false, size = "md", color }: AvatarProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const sizes = { sm: "h-9 w-9 text-xs", md: "h-11 w-11 text-sm", lg: "h-20 w-20 text-xl", xl: "h-28 w-28 text-2xl" };
  const showImage = Boolean(avatarUrl && avatarUrl !== failedAvatarUrl);

  return (
    <span
      className={`avatar relative ${ai ? "avatar-ai" : "avatar-human"} ${sizes[size]}`}
      style={color ? { background: color } : undefined}
      role={name ? "img" : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
    >
      {ai && size === "sm" ? <Sparkles size={14} /> : initials}
      {showImage && (
        // Stored legacy avatars can come from arbitrary remote hosts, so this cannot use next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl!}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedAvatarUrl(avatarUrl!)}
        />
      )}
    </span>
  );
}
