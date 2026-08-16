---
name: observe
version: 1.0.0
description: "Pulls production truth into the session: Cloud Logging errors, Error Reporting groups, and Monitoring latency from the project's GCP deployment, normalized into one severity-ranked \"PROD HEALTH\"... (gstack)"
triggers:
  - prod health
  - check prod errors
  - what's happening in prod
  - pull the logs
  - production errors
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->


## When to invoke this skill

Complements /canary, which watches the live app
from the browser side (console errors, page failures); /observe reads the
server side (what the platform itself recorded). Use when asked "what's
happening in prod", "check prod errors", "pull the logs", "why is the app
slow since the deploy", or "prod health". First run per repo walks through
`gstack-runtime configure`.

Voice triggers (speech-to-text aliases): "observe prod", "check production".

# /observe — Production Health From the Platform's Own Records

`/canary` answers "does the app look alive from a browser?" This skill answers
the other half: what the platform recorded — error groups, log-level errors,
and latency distributions — pulled through `bin/gstack-runtime` and rendered
as one PROD HEALTH block. Everything is PII-redacted (via the repo's shared
`lib/redact-patterns` taxonomy) BEFORE it reaches the conversation, and a
region lock can pin all reads to a single GCP region for data-residency.

## Step 0: Is this repo configured?

```bash
[ -f .claude/observability.yaml ] && echo CONFIGURED || echo NOT_CONFIGURED
```

- `CONFIGURED` → go to Step 1.
- `NOT_CONFIGURED` → run the guided setup. It detects the GCP project, stores
  credentials keychain-first (env fallback), probes each provider's health,
  and ROLLS BACK the config if a probe fails — a half-configured repo is
  worse than an unconfigured one:

```bash
bun ~/.claude/skills/gstack/bin/gstack-runtime configure
```

  If it needs facts only the user has (which GCP project, which region,
  whether region-lock is required), ask with AskUserQuestion — do not guess a
  project id. Then re-run the Step 0 check.

## Step 1: Validate the connection (cheap, no data pulled)

```bash
bun ~/.claude/skills/gstack/bin/gstack-runtime test
```

Every provider must report ok. On an auth failure, say which provider and
stop — re-running fetch on broken auth just burns time. The fix is either
`gcloud auth application-default login` (user does this — it is a login) or
re-running `configure`.

## Step 2: Fetch the health snapshot

```bash
bun ~/.claude/skills/gstack/bin/gstack-runtime fetch
```

This returns the aggregated, already-redacted result: top error groups with
counts and first-seen times, recent deploys, active incidents, and per-endpoint
latency. Per-adapter failures are isolated — one broken provider degrades to a
listed ADAPTER FAILURE instead of killing the whole fetch.

## Step 3: Report like an operator, not a log printer

Lead with the verdict: "prod is healthy" or the single most damaging error
group and who it hits. Then at most: top 3 error groups (count, first seen,
service), any latency endpoint whose p95 moved, and active incidents. Link
each item's `raw_link` so the user can jump to the console. Do NOT paste raw
log lines — the summary exists so the session reads ~30 lines, not 3,000.

If the user asked a specific question ("why is checkout slow?"), filter the
report to signals matching that service/endpoint and say explicitly when the
data does NOT support a cause ("no error spike in the window; latency rose
only on /api/search").

## Redaction is not optional

The fetch path redacts emails, phones, IBANs, national-id-shaped numbers,
credit cards, and JWTs before anything enters the session. If the user asks
for an unredacted value, point them at the `raw_link` — the console shows it
under their own credentials; this session does not.
