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
    moss: `${subject} has taken root. Even after 312 years, a finished step still changes the landscape.`,
    north: `${subject} is logged. Comebacks are built from honest sessions like this one.`,
    orbit: `${subject} produced a measurable result with no unnecessary turbine. Strong experiment.`,
    kage: `Operation ${subject} is complete. The objective no longer controls the field.`,
    zib: `Earth Observation updated: humans can, in fact, finish ${subject}. Useful data.`,
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
