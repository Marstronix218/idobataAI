import { ApiClientError } from "@idobata/api-client";
import type { TaskVisibility } from "@idobata/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

import { InlineNotice } from "@/components/inline-notice";
import { PrimaryButton } from "@/components/primary-button";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { useApiClient } from "@/providers/api-provider";

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "We could not post that win. Please try again.";
}

export default function ShareTaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const client = useApiClient();
  const [taskTitle, setTaskTitle] = useState("");
  const [recurrenceInstanceId, setRecurrenceInstanceId] = useState<string | null>(null);
  const [audience, setAudience] = useState<TaskVisibility>("private");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !taskId) return;
    let active = true;
    void client.listTasks()
      .then((tasks) => {
        if (!active) return;
        const task = tasks.find((item) => item.id === taskId);
        if (!task) throw new Error("That task could not be found.");
        if (task.status !== "completed") throw new Error("Complete this task before sharing it.");
        setTaskTitle(task.title);
        setRecurrenceInstanceId(task.recurrence_instance_id);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, taskId]);

  const publish = async () => {
    if (!client || !taskId || !taskTitle || posted) return;
    setPosting(true);
    setError(null);
    try {
      await client.request<unknown>(`/api/tasks/${encodeURIComponent(taskId)}/publish`, {
        method: "POST",
        body: {
          message: message.trim() || null,
          visibility: audience,
          recurrenceInstanceId,
        },
      });
      setPosted(true);
    } catch (publishError) {
      setError(errorMessage(publishError));
    } finally {
      setPosting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.navbar}>
          <Pressable accessibilityLabel="Back to tasks" hitSlop={10} onPress={() => router.back()}>
            <Text style={styles.back}>‹ Tasks</Text>
          </Pressable>
          <Text style={styles.navTitle}>Post a win</Text>
          <View style={styles.navSpacer} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brandBright} />
            <Text style={styles.loadingText}>Loading your completed task…</Text>
          </View>
        ) : posted ? (
          <View style={styles.center}>
            <View style={styles.successIcon}><Text style={styles.successGlyph}>✓</Text></View>
            <Text style={styles.successTitle}>Your win is posted.</Text>
            <Text style={styles.successBody}>
              It was shared {audience === "public" ? "with the community" : "privately for you only"}.
            </Text>
            <PrimaryButton label="Back to tasks" onPress={() => router.replace("/tasks")} style={styles.fullButton} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {error && <InlineNotice message={error} tone="danger" />}

            <View style={styles.audienceCard}>
              <Text style={styles.sectionLabel}>WHO CAN SEE THIS?</Text>
              <View accessibilityRole="radiogroup" style={styles.segmented}>
                {(["private", "public"] as const).map((value) => {
                  const selected = audience === value;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={value}
                      onPress={() => setAudience(value)}
                      style={[styles.segment, selected && styles.segmentActive]}
                    >
                      <Text style={[styles.segmentTitle, selected && styles.segmentTitleActive]}>
                        {value === "private" ? "● Only me" : "◎ Community"}
                      </Text>
                      <Text style={styles.segmentHint}>
                        {value === "private" ? "A private memory" : "Visible to members"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.composerCard}>
              <TextInput
                accessibilityLabel="Optional comment about this win"
                editable={!posting}
                maxLength={500}
                multiline
                onChangeText={setMessage}
                placeholder="Add a comment about this win…"
                placeholderTextColor={colors.textMuted}
                style={styles.messageInput}
                textAlignVertical="top"
                value={message}
              />
              <Text style={styles.counter}>{message.length}/500</Text>

              <View style={styles.quotedTask}>
                <View style={styles.quotedHeader}>
                  <View style={styles.quotedCheck}><Text style={styles.quotedCheckGlyph}>✓</Text></View>
                  <Text style={styles.quotedMeta}>Your completed task</Text>
                </View>
                <Text style={styles.quotedTitle}>{taskTitle}</Text>
                <Text style={styles.quotedPrivacy}>
                  {audience === "private" ? "Only you will see this post." : "Signed-in members can see this post."}
                </Text>
              </View>
            </View>

            <PrimaryButton
              busy={posting}
              disabled={!taskTitle}
              label={audience === "public" ? "Post to Community" : "Post privately"}
              onPress={() => void publish()}
            />
            <Text style={styles.footerNote}>
              Sharing is always separate from completing a task. Nothing was posted when you checked it off.
            </Text>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  navbar: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", minHeight: 56, paddingHorizontal: spacing.lg },
  back: { color: colors.brandBright, fontFamily: typography.body, fontSize: 16, fontWeight: "700" },
  navTitle: { color: colors.text, flex: 1, fontFamily: typography.display, fontSize: 18, fontWeight: "800", textAlign: "center" },
  navSpacer: { width: 54 },
  content: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.hero },
  center: { alignItems: "center", flex: 1, gap: spacing.lg, justifyContent: "center", padding: spacing.xl },
  loadingText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 14 },
  audienceCard: { gap: spacing.md },
  sectionLabel: { color: colors.brandBright, fontFamily: typography.mono, fontSize: 11, fontWeight: "800", letterSpacing: 1.6 },
  segmented: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", padding: spacing.xs },
  segment: { borderRadius: radius.md, flex: 1, gap: spacing.xs, padding: spacing.md },
  segmentActive: { backgroundColor: colors.surfaceRaised },
  segmentTitle: { color: colors.textMuted, fontFamily: typography.body, fontSize: 14, fontWeight: "800" },
  segmentTitleActive: { color: colors.text },
  segmentHint: { color: colors.textMuted, fontFamily: typography.body, fontSize: 11 },
  composerCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden", padding: spacing.lg },
  messageInput: { color: colors.text, fontFamily: typography.body, fontSize: 17, lineHeight: 25, minHeight: 132 },
  counter: { color: colors.textMuted, fontFamily: typography.mono, fontSize: 11, textAlign: "right" },
  quotedTask: { backgroundColor: colors.canvas, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg },
  quotedHeader: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  quotedCheck: { alignItems: "center", backgroundColor: colors.success, borderRadius: radius.pill, height: 24, justifyContent: "center", width: 24 },
  quotedCheckGlyph: { color: colors.canvas, fontSize: 13, fontWeight: "900" },
  quotedMeta: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, fontWeight: "700" },
  quotedTitle: { color: colors.text, fontFamily: typography.display, fontSize: 19, fontWeight: "800", lineHeight: 26 },
  quotedPrivacy: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, lineHeight: 18 },
  footerNote: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.md, textAlign: "center" },
  successIcon: { alignItems: "center", backgroundColor: colors.success, borderRadius: radius.pill, height: 64, justifyContent: "center", width: 64 },
  successGlyph: { color: colors.canvas, fontSize: 30, fontWeight: "900" },
  successTitle: { color: colors.text, fontFamily: typography.display, fontSize: 28, fontWeight: "800", textAlign: "center" },
  successBody: { color: colors.textMuted, fontFamily: typography.body, fontSize: 15, lineHeight: 22, maxWidth: 340, textAlign: "center" },
  fullButton: { marginTop: spacing.sm, width: "100%" },
});
