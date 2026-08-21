import { Tabs } from "expo-router";
import { type ColorValue, StyleSheet, Text } from "react-native";

import { colors, typography } from "@/constants/theme";

function TabGlyph({ children, color }: { children: string; color: ColorValue }) {
  return <Text style={[styles.glyph, { color }]}>{children}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="tasks"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.brandBright,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontFamily: typography.body,
          fontSize: 11,
          fontWeight: "700",
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color }) => <TabGlyph color={color}>✓</TabGlyph>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <TabGlyph color={color}>●</TabGlyph>,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontFamily: typography.display,
    fontSize: 20,
    fontWeight: "800",
  },
});
