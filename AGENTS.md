<!-- BEGIN:mandatory-subagent-routing -->

# Mandatory subagent routing

For every user prompt, use at least one Codex native subagent before delivering the final response. Route the subagent with an installed `agent_type` that matches the work (for example, `explore` for repository discovery, `executor` for implementation, or `verifier` for validation). Give each subagent a concrete, bounded task and use its result in the response or implementation.

This requirement applies even to small or straightforward prompts. The primary agent remains responsible for integrating the result, verifying the final outcome, and answering the user. Do not substitute OMX `team` mode for native subagent routing unless the task independently warrants coordinated team execution. If native subagents are technically unavailable, state that limitation explicitly and complete the task directly.

<!-- END:mandatory-subagent-routing -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` - verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
