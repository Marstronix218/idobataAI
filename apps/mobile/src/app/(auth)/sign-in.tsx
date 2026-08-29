import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "@/components/brand-mark";
import { InlineNotice } from "@/components/inline-notice";
import { PrimaryButton } from "@/components/primary-button";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { useAuth } from "@/providers/auth-provider";

type Mode = "sign-in" | "sign-up";

export default function SignInScreen() {
  const {
    initializationError,
    isConfigured,
    missingConfiguration,
    recoverSession,
    requiresReauthentication,
    retryInitialization,
    signIn,
    signUp,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setError(null);
    setMessage(null);
    if (!normalizedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "sign-up" && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    setBusy(true);
    try {
      const result = mode === "sign-in"
        ? await signIn(normalizedEmail, password)
        : await signUp(normalizedEmail, password);
      if (result.existingAccount) {
        setMessage("You already have an account with this email — sign in instead.");
        setMode("sign-in");
        setPassword("");
      } else if (result.error) setError(result.error);
      else if (result.requiresEmailConfirmation) {
        setMessage("Check your inbox to confirm your email, then return here to sign in.");
        setMode("sign-in");
        setPassword("");
      }
    } catch {
      setError("Your secure session could not be updated. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const restoreSession = async () => {
    setRecovering(true);
    setError(null);
    try {
      const result = await recoverSession();
      if (result.error) setError(result.error);
    } catch {
      setError("Your secure session could not be restored. Please try again.");
    } finally {
      setRecovering(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <BrandMark />
            <Text style={styles.eyebrow}>IDOBATA</Text>
            <Text style={styles.title}>Small wins feel better together.</Text>
            <Text style={styles.subtitle}>
              Your tasks stay private until you choose to share them.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.modeRow}>
              {(["sign-in", "sign-up"] as const).map((item) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === item }}
                  key={item}
                  onPress={() => {
                    setMode(item);
                    setError(null);
                    setMessage(null);
                  }}
                  style={[styles.modeButton, mode === item && styles.modeButtonActive]}
                >
                  <Text style={[styles.modeLabel, mode === item && styles.modeLabelActive]}>
                    {item === "sign-in" ? "Sign in" : "Create account"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {!isConfigured && (
              <InlineNotice
                message={`Mobile configuration is missing: ${missingConfiguration.join(", ")}. Copy .env.example to .env.local and add the public values.`}
                tone="danger"
              />
            )}
            {initializationError && (
              <>
                <InlineNotice message={initializationError} tone="danger" />
                <Pressable
                  accessibilityRole="button"
                  onPress={retryInitialization}
                  style={styles.recoveryButton}
                >
                  <Text style={styles.recoveryLabel}>Retry secure session</Text>
                </Pressable>
              </>
            )}
            {requiresReauthentication && (
              <>
                <InlineNotice
                  message="Your session needs attention. Try restoring it, or sign in again below."
                  tone="danger"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: recovering }}
                  disabled={recovering}
                  onPress={() => void restoreSession()}
                  style={styles.recoveryButton}
                >
                  <Text style={styles.recoveryLabel}>
                    {recovering ? "Restoring…" : "Restore session"}
                  </Text>
                </Pressable>
              </>
            )}
            {error && <InlineNotice message={error} tone="danger" />}
            {message && <InlineNotice message={message} tone="success" />}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                editable={!busy}
                inputMode="email"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
                style={styles.input}
                value={email}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                editable={!busy}
                onChangeText={setPassword}
                onSubmitEditing={() => void submit()}
                placeholder={mode === "sign-up" ? "At least 8 characters" : "Your password"}
                placeholderTextColor={colors.textMuted}
                returnKeyType="go"
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </View>

            <PrimaryButton
              busy={busy}
              disabled={!isConfigured || Boolean(initializationError)}
              label={mode === "sign-in" ? "Continue" : "Create my account"}
              onPress={() => void submit()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  content: {
    flexGrow: 1,
    gap: spacing.xl,
    justifyContent: "center",
    padding: spacing.xl,
  },
  hero: { alignItems: "center", gap: spacing.md },
  eyebrow: {
    color: colors.brandBright,
    fontFamily: typography.mono,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 3,
  },
  title: {
    color: colors.text,
    fontFamily: typography.display,
    fontSize: 31,
    fontWeight: "800",
    lineHeight: 38,
    maxWidth: 420,
    textAlign: "center",
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: typography.body,
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 380,
    textAlign: "center",
  },
  card: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    maxWidth: 480,
    padding: spacing.xl,
    width: "100%",
  },
  modeRow: {
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    flexDirection: "row",
    padding: spacing.xs,
  },
  modeButton: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  modeButtonActive: { backgroundColor: colors.surfaceRaised },
  modeLabel: {
    color: colors.textMuted,
    fontFamily: typography.body,
    fontSize: 14,
    fontWeight: "700",
  },
  modeLabelActive: { color: colors.text },
  fieldGroup: { gap: spacing.sm },
  label: {
    color: colors.text,
    fontFamily: typography.body,
    fontSize: 14,
    fontWeight: "700",
  },
  input: {
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.body,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  recoveryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  recoveryLabel: {
    color: colors.text,
    fontFamily: typography.body,
    fontSize: 14,
    fontWeight: "800",
  },
});
