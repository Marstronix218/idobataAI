export interface CompletionPostKeyInput {
  authorId: string;
  taskId: string;
  recurrenceInstanceId?: string | null;
}

export function completionPostKey({
  authorId,
  taskId,
  recurrenceInstanceId,
}: CompletionPostKeyInput): string {
  const instance = recurrenceInstanceId?.trim() || "single";
  return `completion:${authorId}:${taskId}:${instance}`;
}
