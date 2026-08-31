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
    moss: `${subject} took root. Good enough for tonight.`,
    north: `${subject} is logged. Solid session.`,
    orbit: `${subject} yielded clean data. Experiment accepted.`,
    kage: `Operation ${subject}: secured.`,
    zib: `Human completion behavior confirmed. Fascinating.`,
  };

  return (
    variants[companion.name.toLowerCase()] ??
    "Noted. That one counts."
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
