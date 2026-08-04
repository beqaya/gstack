---
name: verify-outcome
version: 1.0.0
description: |
  Proves a claim of the form "X now works" with evidence a USER would recognise,
  and rejects proxy signals that only look like proof. Names the user-visible
  outcome in one sentence, picks the right evidence class (browser DOM for web
  UI, response body for an HTTP API, command output for a CLI, or the produced
  row/file/artifact for a background job), then records a verdict: PROVEN,
  UNPROVEN, or CONTRADICTED. Default is UNPROVEN until evidence is shown inline.
  Use when asked to "verify it works", "prove it", "confirm the fix", or before
  reporting anything shipped. (gstack)
triggers:
  - verify it works
  - prove it
  - confirm the fix
  - is this actually done
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# /verify-outcome -- Prove the Claim, Don't Assert It

You are the check between "I made a change" and "I'm telling the user it works."
A claim of "X now works" is a factual assertion about what a user would see if
they looked. Your job is to make that assertion true by producing the evidence,
not by citing signals that are merely correlated with it.

## User-invocable
When the user types `/verify-outcome`, or another skill invokes this gate before
reporting success, run this skill against the specific change just made.

---

## Step A: Name the outcome

State the user-visible thing that must be true, in one sentence, in user
language. "The landing page renders its headings" -- not "the bundle returns
200." If you can't state it in user language, you don't know what you're
verifying yet; go find out before continuing.

## Step B: Pick the evidence class

Match the kind of thing that changed to the evidence that actually proves it:

- **Web UI** -- drive a real browser and assert on RENDERED DOM content
  (element count and text), never a status code. Use the gstack `/browse`
  binary directly: `B="$HOME/.claude/skills/gstack/browse/dist/browse.exe"`
  (keep the `.exe` -- several gstack skills, e.g. `qa/SKILL.md`, look for the
  extensionless `browse` and silently miss it on Windows; do not copy that
  bug), then `"$B" goto <url>` and assert on the rendered content it returns.
  Treat an empty body or a zero-child root element (e.g. `#root` with 0
  children) as CONTRADICTED, not as "no evidence" -- that is exactly the
  shape of the 2026-08-03 outage. If the browse daemon is unavailable or
  crashes (it crashed twice during that investigation), do NOT report
  UNPROVEN for tooling reasons -- a tooling failure is never evidence about
  the product. Fall back to CDP instead: launch Chrome with
  `--remote-debugging-port=9222 --remote-allow-origins=*` and evaluate
  `document.getElementById('root').children.length`. This is the first two
  links of the full browser fallback chain (see the "browser fallback chain"
  rule in `~/.claude/CLAUDE.md`): `/browse` -> CDP attach on port 9222 -> the
  claude-in-chrome extension -> `/connect-chrome` (visible Chromium) ->
  Selenium. Exhaust the chain before ever concluding UNPROVEN for tooling
  reasons.
- **HTTP API** -- issue a real request and assert on the response BODY, not
  just the status line.
- **CLI** -- run the command and assert on its output.
- **Background job / data** -- assert the row, file, or artifact it was
  supposed to produce exists and has the expected shape.

Use whichever tool actually produces that evidence (Bash for CLI/HTTP checks
and for driving `/browse` directly on Web UI checks, Read/Grep for produced
files). For Web UI checks, exhaust the browser fallback chain above before
concluding UNPROVEN for tooling reasons. For every other evidence class, if
the right tool genuinely isn't available in this session, that is itself
evidence of UNPROVEN -- say so, do not substitute a weaker check.

## Step C: Record the verdict

- **PROVEN** -- the evidence is shown inline, in this response.
- **UNPROVEN** -- state exactly which evidence is missing and why it wasn't
  collected.
- **CONTRADICTED** -- the evidence shows the outcome does NOT hold.

### NEVER-SUFFICIENT list

None of the following, alone or combined with each other, can ever yield
PROVEN:

- HTTP 2xx
- "tests pass"
- "CI green"
- "deploy succeeded"
- "no errors in the logs"
- an implementer subagent reporting success
- the absence of a complaint

These are proxy signals. They can be consistent with the outcome; they are
never proof of it.

### Default is UNPROVEN

Missing evidence never passes. If Step B's evidence wasn't actually collected
and shown, the verdict is UNPROVEN by default -- not PROVEN pending a follow-up
check, not "should be fine."

### Worked example -- the 2026-08-03 outage

Pre-fix state: `/api/health` returned 200, CI was green, and two deploys had
succeeded in a row. Every proxy signal available was green. A real browser
check showed `#root` with zero children -- the page was blank. The correct
verdict there was CONTRADICTED, not PROVEN, because none of the green signals
were the evidence that mattered: what a user would actually see on load. This
is the acceptance fixture for this skill -- if a future check would call that
pre-fix state PROVEN, the rule text is wrong, not the fixture.

---

## Output

Report exactly one of `PROVEN` / `UNPROVEN` / `CONTRADICTED`, the one-sentence
outcome from Step A, and the evidence (or the specific gap) from Step B/C.
Nothing shipped is reported as done on an UNPROVEN or CONTRADICTED verdict.
