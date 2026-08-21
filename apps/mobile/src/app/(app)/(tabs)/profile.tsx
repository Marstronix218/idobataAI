import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "@/components/brand-mark";
import { InlineNotice } from "@/components/inline-notice";
import { PrimaryButton } from "@/components/primary-button";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { useAuth } from "@/providers/auth-provider";

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signOut();
      if (result.error) setError(result.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <BrandMark size={58} />
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>YOUR IDOBATA</Text>
            <Text numberOfLines={1} style={styles.email}>{session?.user.email ?? "Signed in"}</Text>
          </View>
        </View>

        {error && <InlineNotice message={error} tone="danger" />}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>One account, every screen</Text>
          <Text style={styles.body}>
            Tasks created here use the same private account, database, and safety rules as the web app.
          </Text>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Secure session stored in the iOS Keychain</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy by default</Text>
          <Text style={styles.body}>
            New mobile tasks are explicitly private. Completing a task does not post it to the community feed.
          </Text>
        </View>

        <PrimaryButton
          busy={busy}
          label="Sign out"
          onPress={() => void handleSignOut()}
          variant="danger"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: { gap: spacing.lg, padding: spacing.xl },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.lg, marginBottom: spacing.sm },
  headerCopy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    color: colors.brandBright,
    fontFamily: typography.mono,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  email: {
    color: colors.text,
    fontFamily: typography.display,
    fontSize: 22,
    fontWeight: "800",
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
  },
  cardTitle: {
    color: colors.text,
    fontFamily: typography.display,
    fontSize: 19,
    fontWeight: "800",
  },
  body: {
    color: colors.textMuted,
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  statusRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  statusDot: { backgroundColor: colors.success, borderRadius: 4, height: 8, width: 8 },
  statusText: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.body,
    fontSize: 13,
    fontWeight: "600",
  },
});
