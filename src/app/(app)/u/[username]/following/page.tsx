import type { Metadata } from "next";
import { FollowPage, parseAudience } from "@/components/profile/follow-page";
import { requirePageGate } from "@/lib/flags/route-gates";

export const metadata: Metadata = { title: "Following" };

/** The other direction, filtered by the same `?kind` the followers route uses. */
export default async function ProfileFollowingPage({ params, searchParams }: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  await requirePageGate("social_feed");
  const username = decodeURIComponent((await params).username);
  const kind = (await searchParams).kind;
  return <FollowPage username={username} direction="following" audience={parseAudience(kind)} />;
}
