import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "../../constants/theme";

// Shown when a created or edited task's text suggests distress (SPEC "Crisis
// routing"), like the web crisis card: the 988 Suicide & Crisis Lifeline by
// call or text, and 911 for immediate danger. It makes no other claims.
// TODO(founder): crisis copy review

function open(url: string) {
  Linking.openURL(url).catch(() => undefined);
}

function Action({ label, url }: { label: string; url: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={() => open(url)} style={styles.action}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export function CrisisNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>988 Suicide & Crisis Lifeline</Text>
      <Text style={styles.body}>Call or text 988.</Text>
      <View style={styles.actions}>
        <Action label="Call 988" url="tel:988" />
        <Action label="Text 988" url="sms:988" />
      </View>
      <Text style={styles.body}>For immediate danger, call 911.</Text>
      <View style={styles.actions}>
        <Action label="Call 911" url="tel:911" />
      </View>
      <Pressable accessibilityLabel="Dismiss crisis resources" accessibilityRole="button" onPress={onDismiss} style={styles.dismiss}>
        <Text style={styles.dismissText}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.text,
    borderRadius: radius.md,
    borderWidth: 2,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  heading: {
    color: colors.text,
    fontFamily: typography.display,
    fontSize: 18,
    fontWeight: "700",
  },
  body: {
    color: colors.text,
    fontFamily: typography.body,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  action: {
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  actionText: {
    color: colors.canvas,
    fontFamily: typography.body,
    fontSize: 15,
    fontWeight: "700",
  },
  dismiss: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  dismissText: {
    color: colors.textMuted,
    fontFamily: typography.body,
    fontSize: 14,
    fontWeight: "600",
  },
});
