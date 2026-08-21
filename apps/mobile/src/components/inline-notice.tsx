import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "@/constants/theme";

type InlineNoticeProps = {
  message: string;
  tone?: "danger" | "success" | "info";
};

const toneColors = {
  danger: colors.danger,
  success: colors.success,
  info: colors.community,
};

export function InlineNotice({ message, tone = "info" }: InlineNoticeProps) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.container, { borderLeftColor: toneColors[tone] }]}
    >
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  text: {
    color: colors.text,
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
});
