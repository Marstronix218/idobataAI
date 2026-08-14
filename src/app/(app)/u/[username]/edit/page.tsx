import type { Metadata } from "next";
import { AppTabLayout } from "@/components/layout/app-tab-layout";
import { ProfileEditor } from "@/components/profile/profile-editor";

export const metadata: Metadata = { title: "Edit profile" };

export default async function EditProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <AppTabLayout contextRail={false}><ProfileEditor routeUsername={decodeURIComponent(username)} /></AppTabLayout>;
}
