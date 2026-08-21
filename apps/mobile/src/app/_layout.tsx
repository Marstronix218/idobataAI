import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";
import { AuthProvider, useAuth } from "@/providers/auth-provider";
import { ApiProvider } from "@/providers/api-provider";

void SplashScreen.preventAutoHideAsync();

function AppNavigator() {
  const { isInitializing } = useAuth();

  useEffect(() => {
    if (!isInitializing) void SplashScreen.hideAsync();
  }, [isInitializing]);

  if (isInitializing) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          headerShown: false,
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ApiProvider>
            <AppNavigator />
          </ApiProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
