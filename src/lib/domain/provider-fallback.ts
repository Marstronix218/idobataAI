export interface FallbackCompanion {
  name: string;
  personality?: string;
}

export interface ReplyContext {
  taskTitle?: string | null;
  category?: string | null;
}

export function fallbackReply(
  companion: FallbackCompanion,
  context: ReplyContext,
): string {
  const task = context.taskTitle?.trim();
  const subject = task ? `“${task}”` : "that task";
  const variants: Record<string, string> = {
    moss: `${subject} is a real handhold for what comes next. You made steady progress visible.`,
    tempo: `A clean finish on ${subject} and a clear next step. That’s solid momentum.`,
    juniper: `Finishing ${subject} made the next session easier for you. That kind of setup counts.`,
    north: `${subject} is logged, finished, and shared. Respect for closing the loop.`,
    orbit: `There is something useful in seeing ${subject} move from idea to done. Nice learning loop.`,
  };

  return (
    variants[companion.name.toLowerCase()] ??
    `${subject} moved forward because you showed up for it. That is worth recognizing.`
  );
}

export async function resolveAIReply({
  generate,
  fallback,
}: {
  generate: () => Promise<string>;
  fallback: string;
}): Promise<{ content: string; source: "provider" | "fallback"; error?: string }> {
  try {
    const content = (await generate()).trim();
    if (!content) throw new Error("Provider returned empty content");
    return { content, source: "provider" };
  } catch (error) {
    return { content: fallback, source: "fallback", error: error instanceof Error ? error.message : "Unknown provider error" };
  }
}
