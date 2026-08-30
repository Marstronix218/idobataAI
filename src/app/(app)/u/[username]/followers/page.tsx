import type { Metadata } from "next";
import { FollowPage } from "@/components/profile/follow-page";

export const metadata: Metadata = { title: "Followers" };

/**
 * People and AI personas share this route because they answer the same
 * question -- who follows this account -- and differ only in what a row can do.
 * `?kind=ai` picks the audience; `Following` is its own route, the way the two
 * directions read as separate pages everywhere else.
 */
export default async function ProfileFollowersPage({ params, searchParams }: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const username = decodeURIComponent((await params).username);
  const kind = (await searchParams).kind;
  return <FollowPage username={username} direction="followers" audience={kind === "ai" ? "ai" : "people"} />;
}
