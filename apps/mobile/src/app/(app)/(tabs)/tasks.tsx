import type { Task } from "@idobata/contracts";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
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

export default function TasksScreen() {
  const [draft, setDraft] = useState("");
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
    setTaskStatus,
  } = useTasks();

  const syncState = error
    ? { color: colors.danger, label: "Needs retry" }
    : isLoading || isRefreshing
      ? { color: colors.community, label: "Syncing" }
      : { color: colors.success, label: "Synced" };

  const addTask = async () => {
    const title = draft.trim();
    if (!title) return;
    const created = await createTask(title);
    if (created) setDraft("");
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
              onShare={() => openShare(item)}
              onToggle={() => void setTaskStatus(item, item.status === "pending" ? "completed" : "pending")}
              task={item}
            />
          )}
        />
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
});
