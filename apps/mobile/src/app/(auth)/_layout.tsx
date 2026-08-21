import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/providers/auth-provider";

export default function AuthLayout() {
  const { requiresReauthentication, session } = useAuth();
  if (session && !requiresReauthentication) return <Redirect href="/tasks" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
