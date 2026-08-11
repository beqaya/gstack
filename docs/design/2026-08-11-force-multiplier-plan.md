# Force-multiplier A1–A3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skill routing deterministic and observable, and make context spend measurable — the three items from the force-multiplier spec that are concrete today.

**Architecture:** Three standalone Python CLIs in `bin/`, each a single-purpose tool with a lookup or a parser and no shared state, following the pattern already proven by `gstack-risk-classify`, `gstack-pipeline` and `gstack-metrics`. One `PostToolUse` hook wires skill invocations to a recorder. Tests are `bun test` files driving the real binaries through `spawnSync`, never re-implementing their logic.

**Tech Stack:** Python 3.13 (`bin/` tools, no third-party deps), TypeScript + `bun test` (tests), gstack's existing `bin/gstack-settings-hook` for hook registration.

## Global Constraints

- `bin/` tools are Python 3, stdlib only, no third-party imports. Match `bin/gstack-run` for style.
- Every tool prints machine-readable output on stdout and human explanation on stderr.
- Exit codes are documented in the module docstring and MUST match what the code returns. Verify before writing them into any skill doc.
- Observers fail OPEN; guards on irreversible resources fail CLOSED. The usage recorder is an observer: it must never block a skill.
- Tests that spawn processes MUST pass an explicit timeout (`}, T);` with `const T = 120000`). Windows process creation trips Bun's 5s default, which surfaces as a `null` exit code rather than a failure.
- No tracked text file may contain a carriage return. `test/generated-hygiene.test.ts` enforces this.
- Skill descriptions stay under 1024 characters (Codex host cap).
- Do NOT edit `*/SKILL.md.tmpl` files in these tasks. They are upstream-owned; editing them multiplies future merge conflicts. These three tasks add new files only.
- Run the full suite before each commit: `GSTACK_PY="C:/Program Files/Python313/python.exe" bun test test/` — 206 tests pass today.

## Measured starting state

These numbers came from the repo on 2026-08-11 and are what the acceptance criteria are measured against.

| Fact | Value |
|---|---|
| gstack skills / declaring `triggers:` | 60 / 59 (`run-supervisor` is the only gap) |
| cyberteam skills / declaring `triggers:` | 61 / **0** |
| Distinct trigger phrases | 276 |
| Phrases claimed by more than one skill | **0** |
| Skills that record their own usage | 6 of 60, via prose |
| Skills that have ever recorded a use | 2 (`careful` 54, `freeze` 23) |

**The problem is not collisions.** It is that 61 of 121 skills carry no routing metadata, so no table can reach them, and `cso` claims the phrase `"security review"` while a skill named `security-review` sits unrouted in the other suite.

## File Structure

| File | Responsibility |
|---|---|
| `bin/gstack-route` (create) | Build the phrase index over both suites; resolve an intent; report unrouted skills |
| `test/route.test.ts` (create) | Drive `gstack-route`; assert coverage, ambiguity and exit codes |
| `bin/gstack-skill-usage` (create) | Append one usage record; never fail loudly |
| `test/skill-usage.test.ts` (create) | Assert recording, fail-open behaviour, malformed input |
| `bin/gstack-context-census` (create) | Attribute a transcript's tokens to named consumers |
| `test/context-census.test.ts` (create) | Assert attribution against a synthetic transcript |

---

### Task 1: `gstack-route` — resolve an intent to exactly one skill

**Files:**
- Create: `bin/gstack-route`
- Test: `test/route.test.ts` (written in Task 2)

**Interfaces:**
- Produces: CLI `gstack-route --intent "<phrase>"` → prints `<suite>:<skill>` on stdout, exit 0. `--unrouted` → prints one `<suite>:<skill>` per line for skills with no triggers. `--index` → prints JSON `{phrase: [owners]}`. Exit 2 = no match, 3 = ambiguous, 4 = no skills found on disk.
- Consumes: nothing.

- [ ] **Step 1: Write the tool**

```python
#!/usr/bin/env python3
"""gstack-route — resolve a spoken intent to exactly one skill.

Routing by prose drifts. Two suites are installed — gstack (60 skills) and
cyberteam (61) — and picking the wrong one costs a full skill load, up to 26,851
tokens, before the mistake is visible.

This is a lookup, not a judgement, exactly like gstack-risk-classify. The index
is DERIVED from `triggers:` frontmatter rather than hand-maintained, so a skill
that declares a phrase owns it and nothing has to be kept in sync by hand.

A miss is reported, never guessed. That is the point: an intent nobody claims is
data for adding a row, and a silent guess produces no data at all.

Usage:
    gstack-route --intent "check for vulnerabilities"
    gstack-route --unrouted
    gstack-route --index

Exit codes:
    0  resolved (or listing completed)
    2  no skill claims that phrase
    3  more than one skill claims it
    4  no skills found on disk
"""
import argparse
import json
import os
import re
import sys

# Inventory comes from SKILL.md — the artifact actually installed — for BOTH
# suites. Reading templates instead would have missed `delegate` and
# `session-lock` (no template) and invented a skill called `claude` (template,
# no SKILL.md). Generated SKILL.md retains `triggers:`; only `voice-triggers:`
# is folded into the description, so the template is read as a second source
# where it exists.
SUITES = (
    ("gstack", "~/.claude/skills/gstack/*/SKILL.md"),
    ("cyber", "~/.claude/skills/cyberteam/skills/*/SKILL.md"),
)
TRIGGER_KEYS = ("triggers", "voice-triggers")


def normalise(phrase):
    """Compare what a reader would hear, not what they typed.

    Punctuation, case and repeated spaces carry no routing meaning, and a table
    that treats "QA test this" and "qa test this." as different phrases is a
    table with silent holes in it.
    """
    return re.sub(r"[^a-z0-9 ]+", "", (phrase or "").lower()).strip()


def skill_files():
    """(suite, name, [files to read]) for every INSTALLED skill."""
    import glob
    found = []
    for suite, pattern in SUITES:
        for path in sorted(glob.glob(os.path.expanduser(pattern))):
            sources = [path]
            template = path + ".tmpl"
            if os.path.exists(template):
                sources.append(template)
            found.append((suite, os.path.basename(os.path.dirname(path)), sources))
    return found


def build_index():
    """phrase -> sorted list of "suite:skill" owners, plus the unrouted skills."""
    index, unrouted = {}, []
    for suite, name, sources in skill_files():
        owner = "%s:%s" % (suite, name)
        claimed = False
        for path in sources:
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            for key in TRIGGER_KEYS:
                pattern = r"^" + key + r":\s*\n((?:\s+-\s+.*\n)+)"
                m = re.search(pattern, text, re.M)
                if not m:
                    continue
                for line in m.group(1).splitlines():
                    phrase = normalise(line.strip().lstrip("-").strip().strip("\"'"))
                    if not phrase:
                        continue
                    claimed = True
                    owners = index.setdefault(phrase, [])
                    if owner not in owners:
                        owners.append(owner)
        if not claimed:
            unrouted.append(owner)
    for owners in index.values():
        owners.sort()
    return index, sorted(unrouted)


def near_misses(index, phrase, limit=5):
    """Phrases sharing a word with the request — what to suggest on a miss."""
    words = set(phrase.split())
    scored = [(len(words & set(p.split())), p) for p in index]
    return [p for score, p in sorted(scored, reverse=True) if score][:limit]


def main():
    ap = argparse.ArgumentParser(prog="gstack-route")
    ap.add_argument("--intent")
    ap.add_argument("--unrouted", action="store_true")
    ap.add_argument("--index", action="store_true")
    args = ap.parse_args()

    index, unrouted = build_index()
    if not index and not unrouted:
        sys.stderr.write("no skills found on disk — nothing to route against.\n")
        sys.exit(4)

    if args.index:
        print(json.dumps(index, indent=2, sort_keys=True))
        return
    if args.unrouted:
        for owner in unrouted:
            print(owner)
        return
    if not args.intent:
        ap.error("--intent is required unless --unrouted or --index is given")

    phrase = normalise(args.intent)
    owners = index.get(phrase, [])
    if len(owners) == 1:
        print(owners[0])
        return
    if not owners:
        sys.stderr.write(
            "no skill claims %r. Closest phrases: %s\n"
            "Nothing was guessed. If a skill should own this, add it to that "
            "skill's `triggers:` frontmatter.\n"
            % (args.intent, ", ".join(near_misses(index, phrase)) or "(none)")
        )
        sys.exit(2)
    sys.stderr.write(
        "%r is claimed by %d skills: %s. One phrase must have one owner — "
        "remove it from all but one.\n" % (args.intent, len(owners), ", ".join(owners))
    )
    sys.exit(3)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify it resolves, misses and reports unrouted**

Run:
```bash
cd "C:/Users/Person/.claude/skills/gstack"
PY="C:/Program Files/Python313/python.exe"
"$PY" bin/gstack-route --intent "check for vulnerabilities"; echo "exit=$?"
"$PY" bin/gstack-route --intent "do security testing"; echo "exit=$?"
"$PY" bin/gstack-route --unrouted | wc -l
```
Expected: `gstack:cso` then `exit=0`; then a "no skill claims" message with near misses and `exit=2`; then `62` (61 cyberteam skills plus `run-supervisor`).

- [ ] **Step 3: Commit**

```bash
git add bin/gstack-route
git commit -m "feat(route): resolve an intent to one skill, or report the miss"
```

---

### Task 2: Routing coverage tests — make the gap fail

**Files:**
- Create: `test/route.test.ts`
- Modify: none

**Interfaces:**
- Consumes: `bin/gstack-route` CLI from Task 1 (`--intent`, `--unrouted`, `--index`; exits 0/2/3/4).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const ROUTE = path.join(ROOT, 'bin', 'gstack-route');
const PY = process.env.GSTACK_PY || 'python';
// Each test spawns a process; Windows creation cost trips Bun's 5s default,
// which surfaces as a null exit code rather than a failure.
const T = 120000;

function route(args: string[]) {
  const o = spawnSync([PY, ROUTE, ...args], { env: { ...process.env } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}

describe('gstack-route resolves, and refuses to guess', () => {
  test('a claimed phrase resolves to exactly one skill', () => {
    const r = route(['--intent', 'check for vulnerabilities']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('gstack:cso');
  }, T);

  test('punctuation and case do not change the answer', () => {
    expect(route(['--intent', 'Check For Vulnerabilities!']).stdout).toBe('gstack:cso');
  }, T);

  // The failure this tool exists for: an unclaimed intent must produce data,
  // not a guess. A silent guess costs a full skill load and teaches nothing.
  test('an unclaimed intent exits 2 and suggests near misses', () => {
    const r = route(['--intent', 'do security testing']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no skill claims');
    expect(r.stderr).toContain('security');
  }, T);

  test('no phrase is claimed by two skills', () => {
    const index = JSON.parse(route(['--index']).stdout);
    const contested = Object.entries<string[]>(index).filter(([, o]) => o.length > 1);
    expect(contested).toEqual([]);
  }, T);
});

describe('routing coverage', () => {
  // 61 of 120 skills declare no triggers, so no table can reach them. This
  // test states the current number so that it can only go DOWN: any skill
  // added without triggers fails the build.
  const KNOWN_UNROUTED = 62;

  test('the unrouted set does not grow', () => {
    const lines = route(['--unrouted']).stdout.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(KNOWN_UNROUTED);
  }, T);

  test('every gstack skill except run-supervisor is routable', () => {
    const unrouted = route(['--unrouted']).stdout.split(/\r?\n/).filter(Boolean);
    const gstackUnrouted = unrouted.filter(l => l.startsWith('gstack:'));
    expect(gstackUnrouted).toEqual(['gstack:run-supervisor']);
  }, T);
});
```

- [ ] **Step 2: Run and confirm the expected failures**

Run: `GSTACK_PY="C:/Program Files/Python313/python.exe" bun test test/route.test.ts`
Expected: all pass except possibly `every gstack skill except run-supervisor is routable`, which documents the one real gap.

- [ ] **Step 3: Give `run-supervisor` triggers so the gap closes**

`run-supervisor` is the only gstack skill this repo authored without triggers. Add them to `run-supervisor/SKILL.md.tmpl` frontmatter, directly after the `description:` block. This is the one template edit permitted in this plan, because the file is not upstream's:

```yaml
triggers:
  - start an unattended run
  - work the queue
  - resume run
  - run supervisor
```

Then regenerate: `bun run gen:skill-docs --catalog-mode=full`

- [ ] **Step 4: Run the tests again**

Run: `GSTACK_PY="C:/Program Files/Python313/python.exe" bun test test/route.test.ts`
Expected: all pass, and `gstackUnrouted` is now `[]`. Update the assertion to `expect(gstackUnrouted).toEqual([]);` and lower `KNOWN_UNROUTED` to `61`.

- [ ] **Step 5: Commit**

```bash
git add test/route.test.ts run-supervisor/SKILL.md.tmpl run-supervisor/SKILL.md
git commit -m "test(route): the unrouted set can only shrink; close the run-supervisor gap"
```

---

### Task 3: `gstack-skill-usage` — instrument all skills, without asking a model to remember

**Files:**
- Create: `bin/gstack-skill-usage`
- Create: `test/skill-usage.test.ts`

**Interfaces:**
- Consumes: a `PostToolUse` hook payload on stdin, JSON with `tool_name` and `tool_input.skill`.
- Produces: appends `{"skill", "ts", "session"}` lines to `$GSTACK_STATE_ROOT/analytics/skill-usage.jsonl` (default `~/.gstack`). Always exits 0.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const REC = path.join(ROOT, 'bin', 'gstack-skill-usage');
const PY = process.env.GSTACK_PY || 'python';
const T = 120000;

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-su-')); }
function record(payload: string, root: string) {
  const o = spawnSync([PY, REC], {
    env: { ...process.env, GSTACK_STATE_ROOT: root }, stdin: Buffer.from(payload),
  });
  return { code: o.exitCode, stderr: o.stderr.toString().trim() };
}
function lines(root: string): any[] {
  const p = path.join(root, 'analytics', 'skill-usage.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

describe('gstack-skill-usage records every invocation', () => {
  test('a Skill invocation is recorded with name and timestamp', () => {
    const root = tmp();
    expect(record(JSON.stringify({
      tool_name: 'Skill', tool_input: { skill: 'qa' }, session_id: 'sess-1',
    }), root).code).toBe(0);
    const recs = lines(root);
    expect(recs.length).toBe(1);
    expect(recs[0].skill).toBe('qa');
    expect(recs[0].session).toBe('sess-1');
    expect(typeof recs[0].ts).toBe('string');
  }, T);

  test('repeated invocations append rather than overwrite', () => {
    const root = tmp();
    for (const s of ['qa', 'ship', 'qa']) {
      record(JSON.stringify({ tool_name: 'Skill', tool_input: { skill: s } }), root);
    }
    expect(lines(root).map(r => r.skill)).toEqual(['qa', 'ship', 'qa']);
  }, T);

  test('a non-Skill tool is ignored', () => {
    const root = tmp();
    record(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), root);
    expect(lines(root)).toEqual([]);
  }, T);
});

describe('the recorder is an observer, so it fails OPEN', () => {
  // A lost telemetry record costs one data point. A telemetry bug that blocks
  // a skill costs the user's work. This asymmetry is the whole design.
  for (const [label, payload] of [
    ['malformed JSON', 'not json at all'],
    ['empty stdin', ''],
    ['missing tool_input', '{"tool_name":"Skill"}'],
    ['null skill', '{"tool_name":"Skill","tool_input":{"skill":null}}'],
  ] as [string, string][]) {
    test(`${label} exits 0 and blocks nothing`, () => {
      const root = tmp();
      const r = record(payload, root);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
    }, T);
  }

  test('an unwritable state root still exits 0', () => {
    const r = record(JSON.stringify({
      tool_name: 'Skill', tool_input: { skill: 'qa' },
    }), path.join(tmp(), 'file-not-a-dir', 'nested'));
    expect(r.code).toBe(0);
  }, T);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `GSTACK_PY="C:/Program Files/Python313/python.exe" bun test test/skill-usage.test.ts`
Expected: FAIL — `bin/gstack-skill-usage` does not exist.

- [ ] **Step 3: Write the recorder**

```python
#!/usr/bin/env python3
"""gstack-skill-usage — record that a skill ran, without asking anyone to remember.

Usage was previously recorded by prose inside six SKILL.md files, so it fired
only when a model happened to follow the instruction. Two skills had ever
recorded a use, out of sixty. This runs as a PostToolUse hook, so coverage is
every skill and cannot be forgotten.

It is an OBSERVER, not a guard, and therefore fails OPEN: every error path exits
0 in silence. A lost record costs one data point; a telemetry bug that blocks a
skill costs the user's work. Guards on irreversible resources fail closed —
this is the other case.

Reads a PostToolUse payload on stdin. Always exits 0.
"""
import datetime
import json
import os
import sys


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict) or payload.get("tool_name") != "Skill":
            return
        skill = (payload.get("tool_input") or {}).get("skill")
        if not skill or not isinstance(skill, str):
            return
        root = os.environ.get("GSTACK_STATE_ROOT") or os.path.join(
            os.path.expanduser("~"), ".gstack")
        directory = os.path.join(root, "analytics")
        os.makedirs(directory, exist_ok=True)
        record = {
            "skill": skill,
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "session": payload.get("session_id"),
        }
        with open(os.path.join(directory, "skill-usage.jsonl"), "a",
                  encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except Exception:
        # Deliberately silent. See the module docstring: an observer that can
        # break the thing it observes is worse than no observer.
        pass


if __name__ == "__main__":
    main()
    sys.exit(0)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `GSTACK_PY="C:/Program Files/Python313/python.exe" bun test test/skill-usage.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Register the hook**

```bash
cd "C:/Users/Person/.claude/skills/gstack"
bin/gstack-settings-hook add-event --event PostToolUse \
  --matcher 'Skill' \
  --command '"C:/Program Files/Python313/python.exe" "C:/Users/Person/.claude/skills/gstack/bin/gstack-skill-usage"' \
  --source skill-usage --timeout 5
```

Verify with a real invocation, not a synthetic payload: invoke any skill, then

```bash
tail -2 ~/.gstack/analytics/skill-usage.jsonl
```
Expected: a record naming the skill just invoked.

- [ ] **Step 6: Commit**

```bash
git add bin/gstack-skill-usage test/skill-usage.test.ts
git commit -m "feat(usage): instrument every skill via hook, not via prose"
```

---

### Task 4: `gstack-context-census` — attribute a session's tokens to named consumers

**Files:**
- Create: `bin/gstack-context-census`
- Create: `test/context-census.test.ts`

**Interfaces:**
- Consumes: a Claude Code transcript `.jsonl` path.
- Produces: CLI `gstack-context-census --transcript <path> [--top N]` → JSON `{total_tokens, by_consumer: {name: tokens}, by_tool: {name: tokens}, unreadable_lines}`. Exit 0 ok, 2 no such file, 3 no attributable content.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const CENSUS = path.join(ROOT, 'bin', 'gstack-context-census');
const PY = process.env.GSTACK_PY || 'python';
const T = 120000;

function census(args: string[]) {
  const o = spawnSync([PY, CENSUS, ...args], { env: { ...process.env } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim(), stderr: o.stderr.toString().trim() };
}

/** A transcript with known content, so attribution can be checked exactly. */
function transcript(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-cc-')), 't.jsonl');
  const rows = [
    { type: 'user', message: { content: 'u'.repeat(400) } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'a'.repeat(800) }] } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'c'.repeat(1200) } }] } },
    { type: 'user', message: { content: [
      { type: 'tool_result', content: 'r'.repeat(1600) }] } },
  ];
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return p;
}

describe('gstack-context-census attributes tokens to consumers', () => {
  test('each consumer is reported, and they sum to the total', () => {
    const out = JSON.parse(census(['--transcript', transcript()]).stdout);
    const c = out.by_consumer;
    expect(Object.keys(c).sort()).toEqual(
      ['assistant text', 'tool calls', 'tool results', 'user text']);
    expect(Object.values<number>(c).reduce((a, b) => a + b, 0)).toBe(out.total_tokens);
  }, T);

  test('the largest consumer is identified correctly', () => {
    const out = JSON.parse(census(['--transcript', transcript()]).stdout);
    // tool_result is the longest string in the fixture at 1600 chars.
    const top = Object.entries<number>(out.by_consumer).sort((a, b) => b[1] - a[1])[0];
    expect(top[0]).toBe('tool results');
  }, T);

  test('tool traffic is broken down by tool name', () => {
    const out = JSON.parse(census(['--transcript', transcript()]).stdout);
    expect(out.by_tool.Bash).toBeGreaterThan(0);
  }, T);

  // A census computed over a partly unreadable file is wrong in a direction
  // nobody can see, so the count travels with the figure.
  test('unreadable lines are counted, not skipped silently', () => {
    const p = transcript();
    fs.appendFileSync(p, '{"type":"user","message":{"conte\n');
    const out = JSON.parse(census(['--transcript', p]).stdout);
    expect(out.unreadable_lines).toBe(1);
  }, T);
});

describe('gstack-context-census refusals', () => {
  test('a missing transcript is an error, not an empty report', () => {
    const r = census(['--transcript', path.join(os.tmpdir(), 'nope.jsonl')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no such transcript');
  }, T);

  test('a transcript with nothing attributable exits 3', () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-cc-')), 'e.jsonl');
    fs.writeFileSync(p, '\n\n');
    expect(census(['--transcript', p]).code).toBe(3);
  }, T);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `GSTACK_PY="C:/Program Files/Python313/python.exe" bun test test/context-census.test.ts`
Expected: FAIL — `bin/gstack-context-census` does not exist.

- [ ] **Step 3: Write the census tool**

```python
#!/usr/bin/env python3
"""gstack-context-census — where a session's context actually went.

Written after a spec proposed optimising a number that never enters a context
window. The suite is ~880,000 tokens on disk and none of it loads at once;
measuring a real session showed tool calls at 42% and tool results at 25%, with
skill loading inside the remaining 19%.

Attribution before optimisation. This reports what a session was made of so the
next diet targets the largest consumer instead of the most alarming number.

Tokens are estimated at 4 characters each. That is a rough constant, and it is
labelled as an estimate in the output rather than presented as a measurement.

Usage:
    gstack-context-census --transcript ~/.claude/projects/<proj>/<id>.jsonl
    gstack-context-census --transcript <path> --top 5

Exit codes:
    0  ok
    2  no such transcript
    3  nothing attributable in the file
"""
import argparse
import json
import os
import sys

CHARS_PER_TOKEN = 4


def add(bucket, key, chars):
    bucket[key] = bucket.get(key, 0) + chars


def census(path):
    by_consumer, by_tool, unreadable = {}, {}, 0
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                unreadable += 1
                continue
            if not isinstance(row, dict):
                unreadable += 1
                continue
            role = row.get("type", "?")
            content = (row.get("message") or {}).get("content")
            if isinstance(content, str):
                add(by_consumer, "%s text" % role, len(content))
                continue
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                kind = block.get("type")
                if kind == "text":
                    add(by_consumer, "%s text" % role, len(block.get("text") or ""))
                elif kind == "thinking":
                    add(by_consumer, "thinking", len(block.get("thinking") or ""))
                elif kind == "tool_use":
                    n = len(json.dumps(block.get("input") or {}))
                    add(by_consumer, "tool calls", n)
                    add(by_tool, block.get("name") or "(unnamed)", n)
                elif kind == "tool_result":
                    body = block.get("content")
                    n = len(body if isinstance(body, str) else json.dumps(body))
                    add(by_consumer, "tool results", n)
    return by_consumer, by_tool, unreadable


def main():
    ap = argparse.ArgumentParser(prog="gstack-context-census")
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--top", type=int, default=0,
                    help="limit the by_tool breakdown to the N largest")
    args = ap.parse_args()

    if not os.path.isfile(args.transcript):
        sys.stderr.write("no such transcript: %s\n" % args.transcript)
        sys.exit(2)

    by_consumer, by_tool, unreadable = census(args.transcript)
    if not by_consumer:
        sys.stderr.write(
            "nothing attributable in %s — %d unreadable line(s). A census over a "
            "file it cannot parse would report zeros that look like a finding.\n"
            % (args.transcript, unreadable))
        sys.exit(3)

    to_tokens = lambda d: {k: v // CHARS_PER_TOKEN for k, v in d.items()}
    tools = sorted(by_tool.items(), key=lambda kv: -kv[1])
    if args.top:
        tools = tools[:args.top]
    print(json.dumps({
        "transcript": args.transcript,
        "total_tokens": sum(by_consumer.values()) // CHARS_PER_TOKEN,
        "by_consumer": to_tokens(by_consumer),
        "by_tool": to_tokens(dict(tools)),
        "unreadable_lines": unreadable,
        "estimated": "Tokens are estimated at %d characters each, not counted by "
                     "a tokeniser." % CHARS_PER_TOKEN,
    }, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `GSTACK_PY="C:/Program Files/Python313/python.exe" bun test test/context-census.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run it on a real session and record the result**

```bash
cd "C:/Users/Person/.claude/skills/gstack"
"C:/Program Files/Python313/python.exe" bin/gstack-context-census \
  --transcript "C:/Users/Person/.claude/projects/C--Users-Person-Downloads-TaskMaster--4--Lezam1/a226f5ae-9541-4c70-87c3-233f696276e8.jsonl" \
  --top 8
```

Expected shape, from the measurement that motivated this plan: `tool calls` ≈ 42%, `tool results` ≈ 25%. Record the `by_tool` breakdown — it is the input that sizes A4, and the decision on whether A5 is worth building at all.

- [ ] **Step 6: Commit**

```bash
git add bin/gstack-context-census test/context-census.test.ts
git commit -m "feat(census): attribute a session's tokens before optimising any of them"
```

---

## Acceptance criteria for this plan

1. `gstack-route --intent` resolves a claimed phrase to exactly one skill, exits 2 on a miss with near misses, and exits 3 on ambiguity.
2. No phrase is claimed by two skills, enforced by test.
3. Every gstack skill is routable; the unrouted set can only shrink, enforced by test.
4. Invoking any skill produces a usage record, verified by a real invocation rather than a synthetic payload.
5. The recorder exits 0 on every malformed input and on an unwritable state root.
6. `gstack-context-census` attributes a real session's tokens by consumer and by tool, and counts unreadable lines.
7. Full suite green: 206 existing tests plus the new ones.

## What this plan deliberately does not do

- It does not touch `scripts/gen-skill-docs.ts` or extract the shared protocol. That is A5, and the spec gates it on what Task 4 measures.
- It does not trim any tool output. That is A4, and its scope is set by Task 4's `by_tool` breakdown.
- It does not add `triggers:` to the 61 cyberteam skills. That is real work with real judgement per skill, and Task 2's test makes the gap visible and non-growing rather than silently tolerated.
