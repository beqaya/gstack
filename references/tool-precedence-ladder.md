# Tool Precedence Ladder — Step Down, Don't Stop

## The rule, generalized

`~/.claude/CLAUDE.md`'s "browser fallback chain" rule (see below) solved one
capability class: when `/browse` fails, try CDP, then claude-in-chrome, then
`/connect-chrome`, then Selenium — switch paths on error, never just say "you
have to do this yourself." That rule works. It has never been generalized to
any other capability, and the gap has cost real work in the same sessions it
was proven in:

- Asked for **Fly logs**, `flyctl` wasn't reachable locally, so **Cloud Run
  logs were substituted** without ever trying the other three ways to get
  actual Fly logs. It happened to share the root cause that time. That was
  luck, not a method — see the worked example below.
- A **credentials file read was blocked** by the content classifier, and the
  work simply stopped instead of asking "what specific value do you actually
  need" or trying a narrower, non-secret-exposing route.

This document is the same "failure on one rung means step down, not stop"
principle, applied to every capability class that has more than one way to
reach the same fact. It is **guidance, not enforcement** — see the Status
section at the bottom before treating anything here as self-executing.

---

## 1. Browser / UI

Canonical version lives in `~/.claude/CLAUDE.md` under "Browser autonomy
(standing authorization)", rule name **"NEVER punt a browser task back to me
— the browser fallback chain."** Do not restate it here; read it there. In
one line: `/browse` (headless, `~/.claude/skills/gstack/browse/dist/browse.exe`
— note the `.exe`) → CDP attach on `--remote-debugging-port=9222` →
claude-in-chrome extension → `/connect-chrome` (visible Chromium) → Selenium.
Switch on any error (tab timeout, "no tab available", extension not
responding); only the STOP list in section 6 below justifies handing back.

Every other ladder in this document that mentions "the browser ladder" means:
go run that chain, don't re-derive it.

---

## 2. Logs / observability

| Rung | Path | What "failed" looks like |
|---|---|---|
| 1 | Provider CLI, locally authenticated (`flyctl logs --app lezam --no-tail`, `gcloud logging read`, `gh run view --log`) | Command not found, auth error, empty/stale token, timeout |
| 2 | Provider REST/API call with a token you already hold (`curl` against the provider's log API, or `WebFetch` against a dashboard JSON endpoint) | 401/403, endpoint requires a session cookie you don't have |
| 3 | Provider's web console, via the **browser ladder** (section 1) — most providers' log viewers work fine through `/browse` if a logged-in session/cookie already exists | Login wall with no existing session → this becomes a real STOP only if it demands credentials/MFA (section 6) |
| 4 | A **workflow-dispatched job that runs inside the environment**, when the environment's own credentials aren't available to you locally | Workflow dispatch itself fails (permissions, workflow file missing) |

This repo has rung 4 built and working: `.github/workflows/fly-logs.yml`
(`C:\Users\Person\Downloads\TaskMaster (4)\Lezam1\.github\workflows\fly-logs.yml`).
It runs inside GitHub Actions using the `FLY_API_TOKEN` **repo secret** —
so it works even when `flyctl` is not installed or not authenticated on
this machine, because the credential lives in CI, not locally. Dispatch it
with `gh workflow run fly-logs.yml -f grep=<substring> -f lines=<n>`, then
poll with `gh run list --workflow=fly-logs.yml` and `gh run view --log
<run-id>` once it completes. There is a sibling, more general workflow,
`.github/workflows/run-script.yml`, that SSHes into the live Fly machine
and runs an arbitrary `tsx` script — usable for one-off diagnostics that a
plain log tail can't answer, same credential-in-CI mechanism.

Fly.io specifically also carries a standing rule (`feedback_never_touch_fly.md`
in project memory): never delete, destroy, or decommission Fly infra, and
never remove `fly-logs.yml` / `run-script.yml` / `fly-deploy.yml` / `fly.toml`.
Reading logs through them is exactly the intended use — the rule is about not
retiring the infrastructure, not about avoiding it.

**Do not silently substitute a different provider's logs for the one asked
for**, even if you believe the root cause is shared. If Fly logs were asked
for and only Cloud Run logs were retrieved, that is a scope substitution, not
an answer — say so explicitly and either get the real Fly logs via rung 3/4
or state plainly "I substituted Cloud Run logs because rungs 1-4 for Fly
failed for X reason; here's why I believe they're the same root cause."
Never make that substitution silently.

---

## 3. Shell / system inspection

Three interpreters exist on this machine: Bash (via the Bash tool, Git Bash
under the hood — no `jq`, no `rg`), PowerShell (primary shell, Windows
11), and Python 3.13 at `C:/Program Files/Python313/python.exe`.

| Rung | Path | What "failed" looks like |
|---|---|---|
| 1 | Bash | Command not found (`jq`, `rg` aren't installed here), POSIX quoting/escaping breaks on a Windows path, exit code nonzero |
| 2 | PowerShell | Cmdlet doesn't exist for the task, or the same quoting-shaped bug recurs in PS syntax |
| 3 | Python (`C:/Program Files/Python313/python.exe`) | Genuinely last resort — if a stdlib-only script can't do it either, this is a real capability gap, not a step-down |

**The lesson from tonight is not just "step down on error" — it's that
switching interpreters is a legitimate VERIFICATION step, not only a
fallback for outright failure.** A Bash quoting failure produced a result
that looked plausible and returned exit 0 — no error, no crash — but was
silently wrong (the quoting had mangled the argument, not rejected it). It
was caught only because the same check was re-run in Python, which parsed
the input correctly and gave a different answer. Treat "the shell accepted
this without complaint" as weaker evidence than "a second interpreter agrees
with it," especially for anything involving quoting of paths with spaces,
Windows backslashes, or nested quotes — all three are exactly where Bash and
PowerShell diverge from each other and from what you'd predict.

---

## 4. File / data inspection

| Rung | Path | What "failed" looks like |
|---|---|---|
| 1 | Read / Grep / Glob tools | File not found, binary/unreadable, or (Glob specifically) a scope so broad the search times out |
| 2 | Python parsing (stdlib: `json`, `csv`, `re`, `xml.etree`, etc., via `C:/Program Files/Python313/python.exe`) | Needed for structured formats (xlsx, docx, pdf beyond what Read handles natively) or when a glob/grep needs logic Read/Grep can't express |
| 3 | A dedicated CLI tool for the format (e.g. a project's own script, `sqlite3`, provider CLI) | The format needs a tool that understands its internal structure better than a generic parser |

Known trap: **Glob times out on very broad roots on this machine** (e.g. the
Downloads folder root) — always scope the pattern to the specific repo or
subdirectory, don't retry the same broad glob expecting a different result.

**The credentials-file case is genuinely different from the other rungs in
this document — it needs a classification step before you decide whether to
step down or stop.** If Read is blocked because a file matches a
secret/credential pattern, first ask: do I actually need the secret VALUE,
or do I need metadata about the file (which keys exist, whether it's
populated, its shape)? If it's metadata, step down: `Grep` for key NAMES
only (not values), ask the user to confirm a specific redacted field, or use
a tool that reports on the credential without exposing it (e.g. `gh auth
status` instead of reading a token file directly). If what's actually needed
is the live secret value itself, that is not a rung to step down through —
it lands in section 6's STOP list, and the correct move is to say precisely
what value is needed and let the user supply it. The failure tonight was
skipping this classification step entirely and just stopping without asking
which case it was.

---

## 5. Cloud / API state

| Rung | Path | What "failed" looks like |
|---|---|---|
| 1 | Provider CLI, locally authenticated (`gcloud`, `gh`, `flyctl`) | Not installed, not authenticated, wrong project/context selected |
| 2 | Direct REST/API call (`curl` or `WebFetch` with a token already held) | 401/403, API requires a flow you don't have (OAuth consent — see section 6) |
| 3 | The provider's web console, via the **browser ladder** (section 1) | Login wall with no existing session and credentials would be required — now it's a genuine STOP per section 6 |

This mirrors section 2 almost exactly because logs are a special case of
cloud/API state — the same three rungs apply, and the same "workflow
dispatched job with CI-held credentials" escape hatch (section 2, rung 4)
applies wherever the target environment's credentials live in CI but not
locally.

---

## 6. When stopping IS correct — the only legitimate hand-backs

Every ladder above bottoms out here. These are the ONLY cases where handing
back to the user is the right move, not a shortcut:

- Entering **credentials** the user must supply (passwords, API keys, tokens
  not already held)
- **MFA / 2FA** codes or prompts
- **CAPTCHA** or bot-detection challenges
- **OAuth / SSO consent** screens, account pickers on login
- **Payment** flows or anything that charges a card
- The **final irreversible action**: sends money, sends a message/email/DM
  to another person, publishes/posts public content, or deletes data

Nothing else on this list. "The CLI wasn't installed," "the API returned an
error," "the file was in a restricted-looking location" are NOT on this
list — they are rung failures, and the response is to try the next rung, not
to stop.

**If you do hand back, state exactly which rungs you tried and what each one
returned.** A bare "I can't do this" is never acceptable — it gives the user
no way to tell a real capability gap from a step you skipped. The minimum
acceptable hand-back looks like: "Tried flyctl locally (not installed),
tried the Fly REST API (no local token), tried the web console via /browse
(hit a login wall requiring MFA — stopping here per the credentials rule).
Need you to log in, then I can continue from the browser session."

---

## 7. Worked example — tonight's Fly-logs case

**What actually happened:** Fly logs were asked for. `flyctl` was not
reachable locally. Cloud Run logs were substituted instead, without stating
that a substitution had happened or trying any other route to real Fly
logs. It turned out to share the root cause with the actual bug — but that
was found out after the fact, not verified before substituting.

**What the ladder in section 2 prescribes instead:**
1. Rung 1 (local `flyctl`) fails — not installed/authenticated. Say so.
2. Rung 2 (Fly REST API with a locally-held token) — check whether
   `FLY_API_TOKEN` or equivalent is available in the local environment; if
   not, this rung is unavailable, say so, move on.
3. Rung 3 (Fly web console via the browser ladder) — if a logged-in Fly
   dashboard session already exists, pull the logs there. If it hits a
   login wall demanding credentials, that's a real section-6 stop for THIS
   rung, but not for the whole ladder yet.
4. Rung 4 — dispatch `.github/workflows/fly-logs.yml` via `gh workflow run
   fly-logs.yml -f grep=<term> -f lines=300`, since `FLY_API_TOKEN` lives as
   a GitHub Actions secret regardless of what's available locally. Poll with
   `gh run list --workflow=fly-logs.yml` then `gh run view --log <run-id>`.
   This rung does not depend on local Fly auth at all, so it should have
   been the one that actually resolved the request — it was never tried.

The corrected version of tonight's answer: "flyctl isn't reachable locally;
dispatching `fly-logs.yml` to pull logs through CI instead" — followed by
the real Fly logs, not a silent substitution of a different service's logs.

---

## Status: this is guidance, not enforcement

Nothing in this document is checked by a hook, a linter, or any mechanism
that would stop an agent from skipping straight to "I can't do this." It is
a reference an agent has to choose to read and follow — same as the browser
fallback chain it generalizes.

Be honest about that distinction: this repo has shipped guards that
**claimed** enforcement and had none.
`bin/gstack-generated-guard` (a PreToolUse hook in `~/.claude/settings.json`)
was wired and appeared live, but emitted the wrong JSON shape
(`permissionDecision` instead of `hookSpecificOutput.permissionDecisionReason`)
and so failed open — it blocked nothing while looking like it did, until
fixed and live-verified on 2026-08-05 (see
`reference_session_a226f5ae_handoff.md` in project memory). The `/freeze`
skill's own edit-restriction hook is suspected to carry the identical
defect and was still unconfirmed as of the same date. Don't describe this
ladder as "enforced" in any report, commit message, or handoff — it is a
checklist an agent reads and applies by discipline, nothing more, unless and
until an actual PreToolUse hook enforces "step down before stopping" the way
`bin/gstack-generated-guard` now enforces its own narrower rule.
