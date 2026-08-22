import type { Task } from "@idobata/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InlineNotice } from "@/components/inline-notice";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { TaskCard } from "@/features/tasks/task-card";
import { type TaskFilter, useTasks } from "@/features/tasks/use-tasks";

type DeadlineTarget = Task | "draft";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localDateValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(value: string | null, hasTime: boolean) {
  if (!value || !hasTime) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDeadline(
  dateValue: string,
  timeValue: string,
): { error: string } | { dueAt: string; dueHasTime: boolean } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  if (!dateMatch) return { error: "Enter the date as YYYY-MM-DD." };
  const timeMatch = timeValue.trim() ? /^(\d{2}):(\d{2})$/.exec(timeValue.trim()) : null;
  if (timeValue.trim() && !timeMatch) return { error: "Enter the time as HH:MM, or leave it blank." };

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = timeMatch ? Number(timeMatch[1]) : 12;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59
    || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
  ) return { error: "Enter a valid deadline date and time." };

  return { dueAt: date.toISOString(), dueHasTime: Boolean(timeMatch) };
}

function deadlineSummary(dueAt: string | null, dueHasTime: boolean) {
  if (!dueAt) return "Not set";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "Not set";
  const dateText = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  if (!dueHasTime) return dateText;
  const timeText = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return `${dateText} · ${timeText}`;
}

export default function TasksScreen() {
  const [deadlineClock, setDeadlineClock] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [draftDueAt, setDraftDueAt] = useState<string | null>(null);
  const [draftDueHasTime, setDraftDueHasTime] = useState(false);
  const [deadlineTarget, setDeadlineTarget] = useState<DeadlineTarget | null>(null);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const {
    visibleTasks,
    counts,
    filter,
    setFilter,
    isLoading,
    isRefreshing,
    creating,
    busyTaskIds,
    error,
    mutationError,
    recentlyCompleted,
    dismissCompletion,
    load,
    createTask,
    setTaskDeadline,
    setTaskStatus,
  } = useTasks();

  useEffect(() => {
    const interval = setInterval(() => setDeadlineClock(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const syncState = error
    ? { color: colors.danger, label: "Needs retry" }
    : isLoading || isRefreshing
      ? { color: colors.community, label: "Syncing" }
      : { color: colors.success, label: "Synced" };

  const addTask = async () => {
    const title = draft.trim();
    if (!title) return;
    const created = await createTask(title, draftDueAt, draftDueHasTime);
    if (created) {
      setDraft("");
      setDraftDueAt(null);
      setDraftDueHasTime(false);
    }
  };

  const openDeadlineEditor = (target: DeadlineTarget) => {
    const dueAt = target === "draft" ? draftDueAt : target.due_at;
    const dueHasTime = target === "draft" ? draftDueHasTime : target.due_has_time;
    setDeadlineTarget(target);
    setDeadlineDate(localDateValue(dueAt));
    setDeadlineTime(localTimeValue(dueAt, dueHasTime));
    setDeadlineError(null);
  };

  const closeDeadlineEditor = () => {
    setDeadlineTarget(null);
    setDeadlineError(null);
  };

  const saveDeadline = async () => {
    if (!deadlineTarget) return;
    if (!deadlineDate.trim()) {
      setDeadlineError("Enter a deadline date, or clear the deadline.");
      return;
    }
    const parsed = parseDeadline(deadlineDate, deadlineTime);
    if ("error" in parsed) {
      setDeadlineError(parsed.error);
      return;
    }
    if (deadlineTarget === "draft") {
      setDraftDueAt(parsed.dueAt);
      setDraftDueHasTime(parsed.dueHasTime);
      closeDeadlineEditor();
      return;
    }
    const updated = await setTaskDeadline(deadlineTarget, parsed.dueAt, parsed.dueHasTime);
    if (updated) closeDeadlineEditor();
  };

  const clearDeadline = async () => {
    if (!deadlineTarget) return;
    if (deadlineTarget === "draft") {
      setDraftDueAt(null);
      setDraftDueHasTime(false);
      closeDeadlineEditor();
      return;
    }
    const updated = await setTaskDeadline(deadlineTarget, null, false);
    if (updated) closeDeadlineEditor();
  };

  const openShare = (task: Task) => {
    router.push({ pathname: "/tasks/[taskId]/share", params: { taskId: task.id } });
  };

  const header = (
    <View style={styles.headerContent}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>YOUR PRIVATE SPACE</Text>
          <Text style={styles.heading}>One small thing.</Text>
          <Text style={styles.subheading}>Finish it, then decide whether it belongs on the feed.</Text>
        </View>
        <View style={styles.syncBadge}>
          <View style={[styles.syncDot, { backgroundColor: syncState.color }]} />
          <Text style={styles.syncText}>{syncState.label}</Text>
        </View>
      </View>

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="New task title"
          editable={!creating}
          maxLength={160}
          onChangeText={setDraft}
          onSubmitEditing={() => void addTask()}
          placeholder="Add a task…"
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          style={styles.composerInput}
          value={draft}
        />
        <Pressable
          accessibilityLabel="Add task privately"
          accessibilityRole="button"
          accessibilityState={{ disabled: creating || !draft.trim() }}
          disabled={creating || !draft.trim()}
          onPress={() => void addTask()}
          style={({ pressed }) => [
            styles.addButton,
            (creating || !draft.trim()) && styles.addButtonDisabled,
            pressed && styles.addButtonPressed,
          ]}
        >
          {creating ? <ActivityIndicator color={colors.text} /> : <Text style={styles.addGlyph}>＋</Text>}
        </Pressable>
        <View style={styles.deadlinePicker}>
          <Text style={styles.deadlineLabel}>Deadline (optional)</Text>
          <Pressable
            accessibilityLabel={`Set deadline for new task. ${deadlineSummary(draftDueAt, draftDueHasTime)}`}
            accessibilityRole="button"
            disabled={creating}
            onPress={() => openDeadlineEditor("draft")}
            style={styles.deadlineButton}
          >
            <Text style={styles.deadlineButtonText}>{deadlineSummary(draftDueAt, draftDueHasTime)}</Text>
          </Pressable>
        </View>
        <View style={styles.privateRow}>
          <Text style={styles.privateIcon}>●</Text>
          <Text style={styles.privateText}>Starts private</Text>
        </View>
      </View>

      {mutationError && <InlineNotice message={mutationError} tone="danger" />}
      {error && visibleTasks.length > 0 && <InlineNotice message={error} tone="danger" />}

      {recentlyCompleted && (
        <View style={styles.completedCard}>
          <View style={styles.completedIcon}><Text style={styles.completedGlyph}>✓</Text></View>
          <View style={styles.completedCopy}>
            <Text style={styles.completedLabel}>DONE — NOT POSTED</Text>
            <Text numberOfLines={2} style={styles.completedTitle}>{recentlyCompleted.title}</Text>
            <Text style={styles.completedBody}>It stays off the feed unless you share it.</Text>
            <View style={styles.completedActions}>
              <Pressable onPress={() => openShare(recentlyCompleted)} style={styles.actionButton}>
                <Text style={styles.actionPrimary}>Share</Text>
              </Pressable>
              <Pressable
                disabled={busyTaskIds.has(recentlyCompleted.id)}
                onPress={() => void setTaskStatus(recentlyCompleted, "pending")}
                style={styles.actionButton}
              >
                <Text style={styles.actionSecondary}>Undo</Text>
              </Pressable>
              <Pressable onPress={dismissCompletion} style={styles.actionButton}>
                <Text style={styles.actionSecondary}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      <View accessibilityRole="tablist" style={styles.filters}>
        {(["pending", "completed"] as TaskFilter[]).map((item) => {
          const active = filter === item;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item}
              onPress={() => setFilter(item)}
              style={[styles.filterButton, active && styles.filterButtonActive]}
            >
              <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                {item === "pending" ? "Open" : "Completed"} · {counts[item]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <FlatList
          contentContainerStyle={styles.listContent}
          data={visibleTasks}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(task) => task.id}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.empty}><ActivityIndicator color={colors.brandBright} /><Text style={styles.emptyBody}>Loading your tasks…</Text></View>
            ) : error ? (
              <View style={styles.empty}>
                <InlineNotice message={error} tone="danger" />
                <Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryLabel}>Try again</Text></Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}><Text style={styles.emptyGlyph}>✓</Text></View>
                <Text style={styles.emptyTitle}>{filter === "pending" ? "Your list is clear." : "No completed tasks yet."}</Text>
                <Text style={styles.emptyBody}>{filter === "pending" ? "Add one small thing above when you are ready." : "Finished tasks will collect here."}</Text>
              </View>
            )
          }
          ListHeaderComponent={header}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.brandBright}
            />
          }
          renderItem={({ item }) => (
            <TaskCard
              busy={busyTaskIds.has(item.id)}
              now={deadlineClock}
              onEditDeadline={() => openDeadlineEditor(item)}
              onShare={() => openShare(item)}
              onToggle={() => void setTaskStatus(item, item.status === "pending" ? "completed" : "pending")}
              task={item}
            />
          )}
        />
        <Modal animationType="fade" onRequestClose={closeDeadlineEditor} transparent visible={Boolean(deadlineTarget)}>
          <View style={styles.modalRoot}>
            <Pressable accessibilityLabel="Close deadline editor" accessibilityRole="button" onPress={closeDeadlineEditor} style={styles.modalBackdrop} />
            {deadlineTarget && (
              <View accessibilityLabel="Task deadline" accessibilityViewIsModal role="dialog" style={styles.modalCard}>
                <ScrollView contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
                  <Text style={styles.modalEyebrow}>TASK DETAILS</Text>
                  <Text style={styles.modalTitle}>Task deadline</Text>
                  <Text numberOfLines={2} style={styles.modalTaskTitle}>
                    {deadlineTarget === "draft" ? draft.trim() || "New task" : deadlineTarget.title}
                  </Text>
                  <Text style={styles.modalBody}>Set the day this task is due. Add a time only when it has an exact cutoff.</Text>
                  {deadlineError && <InlineNotice message={deadlineError} tone="danger" />}
                  {mutationError && <InlineNotice message={mutationError} tone="danger" />}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Due date</Text>
                    <TextInput
                      accessibilityLabel="Deadline date"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={deadlineTarget === "draft" || !busyTaskIds.has(deadlineTarget.id)}
                      keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                      onChangeText={(value) => { setDeadlineDate(value); setDeadlineError(null); }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textMuted}
                      style={styles.fieldInput}
                      value={deadlineDate}
                    />
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Deadline time (optional)</Text>
                    <TextInput
                      accessibilityLabel="Deadline time optional"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={deadlineTarget === "draft" || !busyTaskIds.has(deadlineTarget.id)}
                      keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                      onChangeText={(value) => { setDeadlineTime(value); setDeadlineError(null); }}
                      placeholder="HH:MM"
                      placeholderTextColor={colors.textMuted}
                      style={styles.fieldInput}
                      value={deadlineTime}
                    />
                    <Text style={styles.fieldHint}>Use 24-hour time, or leave blank for any time that day.</Text>
                  </View>
                  <View style={styles.modalActions}>
                    <Pressable accessibilityRole="button" onPress={() => void saveDeadline()} style={styles.saveButton}>
                      <Text style={styles.saveButtonText}>Save deadline</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => void clearDeadline()} style={styles.clearButton}>
                      <Text style={styles.clearButtonText}>Clear deadline</Text>
                    </Pressable>
                  </View>
                </ScrollView>
                <Pressable accessibilityRole="button" onPress={closeDeadlineEditor} style={styles.modalClose}>
                  <Text style={styles.modalCloseText}>Cancel</Text>
                </Pressable>
              </View>
            )}
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  listContent: { flexGrow: 1, padding: spacing.xl, paddingBottom: 110 },
  headerContent: { gap: spacing.lg, marginBottom: spacing.lg },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  headingCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.brandBright, fontFamily: typography.mono, fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  heading: { color: colors.text, fontFamily: typography.display, fontSize: 29, fontWeight: "800", lineHeight: 35 },
  subheading: { color: colors.textMuted, fontFamily: typography.body, fontSize: 14, lineHeight: 20 },
  syncBadge: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.pill, borderWidth: 1, flexDirection: "row", gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  syncDot: { borderRadius: 4, height: 7, width: 7 },
  syncText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 11, fontWeight: "700" },
  composer: { backgroundColor: colors.surface, borderColor: "rgba(124, 58, 237, 0.45)", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", flexWrap: "wrap", overflow: "hidden", padding: spacing.sm },
  composerInput: { color: colors.text, flex: 1, fontFamily: typography.body, fontSize: 16, minHeight: 50, minWidth: 180, paddingHorizontal: spacing.md },
  addButton: { alignItems: "center", backgroundColor: colors.brand, borderRadius: radius.md, height: 48, justifyContent: "center", width: 48 },
  addButtonDisabled: { opacity: 0.45 },
  addButtonPressed: { opacity: 0.8 },
  addGlyph: { color: colors.text, fontFamily: typography.display, fontSize: 25, fontWeight: "600", lineHeight: 28 },
  deadlinePicker: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexBasis: "100%", flexDirection: "row", gap: spacing.md, justifyContent: "space-between", marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  deadlineLabel: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, fontWeight: "700" },
  deadlineButton: { alignItems: "center", backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.md },
  deadlineButtonText: { color: colors.brandBright, fontFamily: typography.body, fontSize: 12, fontWeight: "700" },
  privateRow: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexBasis: "100%", flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  privateIcon: { color: colors.textMuted, fontSize: 8 },
  privateText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, fontWeight: "700" },
  completedCard: { backgroundColor: "rgba(74, 222, 128, 0.10)", borderColor: "rgba(74, 222, 128, 0.44)", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing.md, padding: spacing.lg },
  completedIcon: { alignItems: "center", backgroundColor: colors.success, borderRadius: radius.pill, height: 36, justifyContent: "center", width: 36 },
  completedGlyph: { color: colors.canvas, fontSize: 18, fontWeight: "900" },
  completedCopy: { flex: 1, gap: spacing.xs },
  completedLabel: { color: colors.success, fontFamily: typography.mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  completedTitle: { color: colors.text, fontFamily: typography.display, fontSize: 18, fontWeight: "800" },
  completedBody: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, lineHeight: 19 },
  completedActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  actionPrimary: { color: colors.success, fontFamily: typography.body, fontSize: 13, fontWeight: "800" },
  actionSecondary: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, fontWeight: "700" },
  filters: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", padding: spacing.xs },
  filterButton: { alignItems: "center", borderRadius: radius.sm, flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  filterButtonActive: { backgroundColor: colors.surfaceRaised },
  filterLabel: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, fontWeight: "700" },
  filterLabelActive: { color: colors.text },
  empty: { alignItems: "center", gap: spacing.md, justifyContent: "center", minHeight: 240, paddingHorizontal: spacing.lg },
  emptyIcon: { alignItems: "center", backgroundColor: "rgba(74, 222, 128, 0.12)", borderRadius: radius.pill, height: 54, justifyContent: "center", width: 54 },
  emptyGlyph: { color: colors.success, fontSize: 24, fontWeight: "900" },
  emptyTitle: { color: colors.text, fontFamily: typography.display, fontSize: 21, fontWeight: "800", textAlign: "center" },
  emptyBody: { color: colors.textMuted, fontFamily: typography.body, fontSize: 14, lineHeight: 21, textAlign: "center" },
  retryButton: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  retryLabel: { color: colors.text, fontFamily: typography.body, fontSize: 14, fontWeight: "800" },
  modalRoot: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing.xl },
  modalBackdrop: { backgroundColor: colors.overlay, bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  modalCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, maxHeight: "90%", maxWidth: 520, padding: spacing.xl, width: "100%" },
  modalScrollContent: { gap: spacing.md },
  modalEyebrow: { color: colors.brandBright, fontFamily: typography.mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  modalTitle: { color: colors.text, fontFamily: typography.display, fontSize: 24, fontWeight: "800" },
  modalTaskTitle: { color: colors.text, fontFamily: typography.body, fontSize: 15, fontWeight: "700" },
  modalBody: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, lineHeight: 19 },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { color: colors.text, fontFamily: typography.body, fontSize: 13, fontWeight: "800" },
  fieldInput: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontFamily: typography.mono, fontSize: 16, minHeight: 48, paddingHorizontal: spacing.md },
  fieldHint: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, lineHeight: 18 },
  modalActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  saveButton: { alignItems: "center", backgroundColor: colors.brand, borderRadius: radius.md, justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.lg },
  saveButtonText: { color: colors.text, fontFamily: typography.body, fontSize: 13, fontWeight: "800" },
  clearButton: { alignItems: "center", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.lg },
  clearButtonText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 13, fontWeight: "800" },
  modalClose: { alignItems: "center", alignSelf: "flex-end", justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.md },
  modalCloseText: { color: colors.textMuted, fontFamily: typography.body, fontSize: 14, fontWeight: "800" },
});
