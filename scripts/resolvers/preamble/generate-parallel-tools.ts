/**
 * Parallel tool-call directive.
 *
 * The context census measured ~1,795 round trips per session at a ~1s fixed
 * floor each — the single largest wall-clock cost (~39% of a session), while
 * the median tool result is only 58 tokens. Models parallelize independent
 * calls at a high rate unprompted, and Anthropic's prompting guidance
 * documents that a short explicit directive pushes that to ~100%. One
 * rendered block here amortizes every remaining round trip suite-wide.
 */
export function generateParallelTools(): string {
  return `## Tool-Call Batching

Round trips, not tokens, are this suite's measured bottleneck. Two standing rules:

1. **Independent calls go in ONE message.** Reading several files, running
   unrelated checks, launching multiple searches — issue them together in a
   single response, never one-per-turn. Only serialize when a call's input
   depends on a previous call's output.
2. **Prefer one script over N calls.** A sequence of small shell commands with
   no decisions between them (status + log + diff, a loop over files) should
   run as ONE command or script that returns one summary — not as N separate
   tool calls. For browser work, use \`$B\` batch endpoints where available.`;
}
