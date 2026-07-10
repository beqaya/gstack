import { registryAsPromptText } from "../primitives/registry";

export interface ProjectContext {
  branch: string;
  recentCommits: string[];
}

export interface PromptOpts {
  goal: string;
  projectContext: ProjectContext;
  maxNodes: number;
  maxDepth: number;
}

export function buildSynthesisPrompt(opts: PromptOpts): string {
  return `You are a planner for gstack synth. Produce a JSON Plan that achieves the user's goal using ONLY the registered primitives below. Phase 1.1-1.3 supports READ-ONLY primitives only — DO NOT use write_file, git_commit, git_push, pr_create, or any mutating operation.

## User goal
${opts.goal}

## Project context
- Current branch: ${opts.projectContext.branch}
- Recent commits (oldest first):
${opts.projectContext.recentCommits.map(c => `  - ${c}`).join("\n") || "  (none provided)"}

## Available primitives
${registryAsPromptText()}

## Output format

Return a single JSON object with this exact shape (no prose, no markdown fences):

\`\`\`
{
  "plan_id": "p_<short-uuid>",
  "goal": "<echo of user goal>",
  "created_at": "<ISO 8601 UTC>",
  "nodes": [
    {
      "id": "<unique id like n1, n2>",
      "primitive": { "op": "<one of the primitive ops>", ...args },
      "depends_on": ["<other node id>", ...],
      "label": "<optional human label>"
    }
  ],
  "estimated_cost_usd": <number>
}
\`\`\`

## Hard constraints

- Max nodes: ${opts.maxNodes}
- Max depth (longest dependency chain): ${opts.maxDepth}
- Read-only primitives only.
- Every node's \`depends_on\` must reference an existing node id.
- No cycles.
- Prefer parallel orchestration when independent reads can run concurrently.

Return the JSON now.`;
}
