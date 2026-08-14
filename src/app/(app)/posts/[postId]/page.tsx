import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { PostThread } from "@/components/social/post-thread";

export const metadata: Metadata = { title: "Post" };

export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  return <AppTabLayout><PostThread postId={postId} /></AppTabLayout>;
}
