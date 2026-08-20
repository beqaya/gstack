import type { TemplateContext } from '../types';

/**
 * Runtime injection of the skill's ACE learned playbook.
 *
 * The bullets a skill accumulated are useless if they only appear after a
 * `gen-skill-docs` regen — a lesson learned today must be in effect on the
 * next run. So this emits a bash block that reads the store LIVE at skill
 * start (like the update-check and session blocks around it), rather than
 * baking bullets into the generated SKILL.md. Empty output when the skill has
 * no approved bullets, so it costs nothing until a lesson is curated in.
 */
export function generateLearnedPlaybook(ctx: TemplateContext): string {
  const skill = ctx.skillName;
  if (!skill) return '';
  return `## Learned playbook (runtime)

This skill may carry lessons curated from past runs. Load them now — they are
standing rules for this run:

\`\`\`bash
${ctx.paths.binDir}/gstack-playbook render ${skill} 2>/dev/null || true
\`\`\`

If that prints a "Learned playbook" block, treat each bullet as a rule unless
it plainly conflicts with the user's request. If it prints nothing, there are
no curated lessons yet — proceed normally.`;
}
