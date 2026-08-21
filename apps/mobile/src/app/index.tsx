import { Redirect } from "expo-router";

import { useAuth } from "@/providers/auth-provider";

export default function IndexRoute() {
  const { requiresReauthentication, session } = useAuth();
  return <Redirect href={session && !requiresReauthentication ? "/tasks" : "/sign-in"} />;
}
