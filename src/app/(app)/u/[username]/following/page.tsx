import type { Metadata } from "next";
import { FollowPage } from "@/components/profile/follow-page";

export const metadata: Metadata = { title: "Following" };

/** The other direction, filtered by the same `?kind` the followers route uses. */
export default async function ProfileFollowingPage({ params, searchParams }: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const username = decodeURIComponent((await params).username);
  const kind = (await searchParams).kind;
  return <FollowPage username={username} direction="following" audience={kind === "ai" ? "ai" : "people"} />;
}
