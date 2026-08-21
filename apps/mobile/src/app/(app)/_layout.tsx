import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/providers/auth-provider";

export default function ProtectedLayout() {
  const { requiresReauthentication, session } = useAuth();
  if (!session || requiresReauthentication) return <Redirect href="/sign-in" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
