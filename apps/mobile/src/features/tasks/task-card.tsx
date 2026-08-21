import type { Task } from "@idobata/contracts";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "@/constants/theme";

type TaskCardProps = {
  task: Task;
  busy: boolean;
  onToggle: () => void;
  onShare: () => void;
};

function dueLabel(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function TaskCard({ task, busy, onToggle, onShare }: TaskCardProps) {
  const isComplete = task.status === "completed";
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={`${isComplete ? "Reopen" : "Complete"}: ${task.title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isComplete, disabled: busy }}
        disabled={busy}
        hitSlop={10}
        onPress={onToggle}
        style={[styles.check, isComplete && styles.checkComplete]}
      >
        {busy ? (
          <ActivityIndicator color={isComplete ? colors.canvas : colors.success} size="small" />
        ) : (
          <Text style={[styles.checkGlyph, isComplete && styles.checkGlyphComplete]}>
            {isComplete ? "✓" : ""}
          </Text>
        )}
      </Pressable>

      <View style={styles.copy}>
        <Text numberOfLines={3} style={[styles.title, isComplete && styles.titleComplete]}>
          {task.title}
        </Text>
        <View style={styles.metaRow}>
          {task.priority && <Text style={styles.priority}>Priority {task.priority}</Text>}
          {task.category && <Text style={styles.category}>{task.category}</Text>}
          <Text style={styles.meta}>{dueLabel(task.due_at)}</Text>
          <Text style={task.visibility === "private" ? styles.private : styles.public}>
            {task.visibility === "private" ? "Private" : "Community"}
          </Text>
        </View>
      </View>

      {isComplete && (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onShare}>
          <Text style={styles.share}>Share</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
  },
  check: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 30,
    justifyContent: "center",
    marginTop: 1,
    width: 30,
  },
  checkComplete: { backgroundColor: colors.success, borderColor: colors.success },
  checkGlyph: { color: colors.success, fontSize: 16, fontWeight: "900" },
  checkGlyphComplete: { color: colors.canvas },
  copy: { flex: 1, gap: spacing.sm },
  title: {
    color: colors.text,
    fontFamily: typography.body,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  titleComplete: { color: colors.textMuted, textDecorationLine: "line-through" },
  metaRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  priority: {
    backgroundColor: "rgba(124, 58, 237, 0.20)",
    borderRadius: radius.pill,
    color: colors.brandBright,
    fontFamily: typography.mono,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  category: {
    color: colors.community,
    fontFamily: typography.body,
    fontSize: 12,
    fontWeight: "700",
  },
  meta: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12 },
  private: { color: colors.textMuted, fontFamily: typography.body, fontSize: 12, fontWeight: "700" },
  public: { color: colors.community, fontFamily: typography.body, fontSize: 12, fontWeight: "700" },
  share: { color: colors.brandBright, fontFamily: typography.body, fontSize: 13, fontWeight: "800", paddingTop: 4 },
});
