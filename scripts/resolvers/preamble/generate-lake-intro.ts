

export function generateLakeIntro(): string {
  // The four onboarding gates (lake intro, telemetry, proactive, routing) used
  // to fire inside every skill preamble. That's the wrong moment — the user is
  // trying to do work, not configure gstack. They're now gated by the
  // ~/.gstack/.onboarding-deferred sentinel; if set, the gates are skipped.
  // Run \`/gstack-onboard\` (or set the sentinel manually) to opt out.
  return `If \`LAKE_INTRO\` is \`no\` AND \`~/.gstack/.onboarding-deferred\` does NOT exist: say "gstack follows the **Boil the Lake** principle — do the complete thing when AI makes marginal cost near-zero. Read more: https://garryslist.org/posts/boil-the-ocean" Offer to open:

\`\`\`bash
open https://garryslist.org/posts/boil-the-ocean
touch ~/.gstack/.completeness-intro-seen
\`\`\`

Only run \`open\` if yes. Always run \`touch\`. If the deferred sentinel exists, skip this section entirely.`;
}
