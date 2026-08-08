# Core Runtime (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a file-backed runtime that lets gstack run unattended on assigned work without ever reporting success it did not achieve.

**Architecture:** A run is a directory under `~/.gstack/runs/<run-id>/`, not a process. Durable state is append-only JSONL written exclusively by the `gstack-run` CLI. Claude Code sessions are disposable workers that claim items via atomic-create locks; a killed worker's item returns to the queue when its lock TTL expires. Enforcement lives in `PreToolUse` hooks, the only mechanism in this harness that actually blocks a tool call.

**Tech Stack:** Python 3 for `bin/` CLIs and hooks (matching `gstack-failure-count` and `gstack-generated-guard`). `bun test` with `spawnSync` from `bun` for tests (matching `test/telemetry-repo-strip.test.ts`). No new runtime dependencies.

## Global Constraints

- Python 3 only for `bin/` scripts. Shebang `#!/usr/bin/env python3`. No pip packages — standard library only.
- Every `bin/` script opens with a docstring stating usage, state layout, and semantics, matching `bin/gstack-failure-count`.
- All state lives under `~/.gstack/runs/<run-id>/`. Never write inside the repo.
- `manifest.json` and `resume.json` are rewritten whole. Every other state file is **append-only JSONL** — never rewritten, never truncated.
- Every JSONL line carries `"ts"` as a UTC ISO-8601 string.
- `manifest.json` carries `"schema": 1`. Any reader encountering an unknown schema version halts rather than guessing.
- Only `bin/gstack-run` writes run state. No other script or agent writes these files.
- Guards fail **open** (allow + log on internal error). Budget enforcement fails **closed** (deny when spend cannot be determined).
- Tests run with `bun test <file>`. Never leave state in the real `~/.gstack` — every test sets `GSTACK_STATE_ROOT` to a temp dir.
- Windows: never assume `ln -s` works, and never test a path's existence only through Git Bash, which silently redirects bare names to `.exe` siblings.

---

## File Structure

| File | Responsibility |
|---|---|
| `bin/gstack-run` | Sole writer of run state; all subcommands |
| `bin/gstack-risk-classify` | Maps an action to `routine` or `elevated` |
| `bin/gstack-budget-guard` | PreToolUse hook enforcing the token ceiling |
| `run-supervisor/SKILL.md.tmpl` | The worker loop skill |
| `test/run-cli.test.ts` | Init, status, schema |
| `test/run-queue.test.ts` | Claim, done, stale reclaim |
| `test/run-journal.test.ts` | Verdicts and supersession |
| `test/run-park.test.ts` | Parked approvals |
| `test/run-budget.test.ts` | Ledger and ceiling |
| `test/run-risk-classify.test.ts` | Tier lookup |
| `test/run-budget-guard.test.ts` | Hook block/allow pair |
| `test/run-acceptance.test.ts` | Falsified-claim detection |

`bin/gstack-run` is one file because its subcommands share the state-path and JSONL-append helpers, and splitting them would mean four copies of the same append routine. It should stay under ~400 lines; if it grows past that, split the helpers into `bin/gstack_run_state.py` and keep the CLI as the entry point.

---

### Task 1: Run state foundation — `init` and `status`

**Files:**
- Create: `bin/gstack-run`
- Test: `test/run-cli.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `gstack-run init --goal <str> --budget <int>` prints the run id to stdout and exits 0. `gstack-run status --run <id>` prints JSON with keys `run_id`, `goal`, `budget_tokens`, `status`, `created_at`, `schema`. State root is `$GSTACK_STATE_ROOT` if set, else `~/.gstack`. Run dir is `<state_root>/runs/<run-id>/`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-run-'));
}

function run(args: string[], stateRoot: string) {
  const out = spawnSync([PY, RUN, ...args], {
    env: { ...process.env, GSTACK_STATE_ROOT: stateRoot },
  });
  return {
    code: out.exitCode,
    stdout: out.stdout.toString().trim(),
    stderr: out.stderr.toString().trim(),
  };
}

describe('gstack-run init/status', () => {
  test('init creates a run dir and status reports it back', () => {
    const root = tmpRoot();
    const init = run(['init', '--goal', 'fix the widget', '--budget', '50000'], root);
    expect(init.code).toBe(0);
    const runId = init.stdout;
    expect(runId.length).toBeGreaterThan(0);

    const dir = path.join(root, 'runs', runId);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);

    const st = run(['status', '--run', runId], root);
    expect(st.code).toBe(0);
    const m = JSON.parse(st.stdout);
    expect(m.schema).toBe(1);
    expect(m.goal).toBe('fix the widget');
    expect(m.budget_tokens).toBe(50000);
    expect(m.status).toBe('active');
  });

  test('status on an unknown schema halts instead of guessing', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '10'], root).stdout;
    const mf = path.join(root, 'runs', runId, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf-8'));
    m.schema = 99;
    fs.writeFileSync(mf, JSON.stringify(m));

    const st = run(['status', '--run', runId], root);
    expect(st.code).not.toBe(0);
    expect(st.stderr).toContain('schema');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-cli.test.ts`
Expected: FAIL — `bin/gstack-run` does not exist, so the spawn produces a non-zero exit and `init.stdout` is empty.

- [ ] **Step 3: Write minimal implementation**

```python
#!/usr/bin/env python3
"""gstack-run — sole writer of unattended-run state.

A run is a directory, not a process. State lives under
<state-root>/runs/<run-id>/ and survives the session that created it, so a
run resumes from disk rather than from a surviving process.

Usage:
    gstack-run init --goal <text> --budget <tokens>
    gstack-run status --run <run-id>

State root: $GSTACK_STATE_ROOT, else ~/.gstack

Files:
    manifest.json   whole-file rewrite; carries "schema" for version gating
    queue.jsonl     append-only work items and transitions
    journal.jsonl   append-only claims with verdict + evidence
    parked.jsonl    append-only items blocked on founder approval
    ledger.jsonl    append-only token spend

Every file except manifest.json and resume.json is append-only. Appends at
these sizes are atomic, so concurrent workers cannot corrupt each other, and
a crash mid-write loses at most the trailing line rather than the file.
"""
import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone

SCHEMA = 1


def now_ts():
    return datetime.now(timezone.utc).isoformat()


def state_root():
    return os.environ.get("GSTACK_STATE_ROOT") or os.path.join(
        os.path.expanduser("~"), ".gstack"
    )


def run_dir(run_id):
    return os.path.join(state_root(), "runs", run_id)


def read_manifest(run_id):
    path = os.path.join(run_dir(run_id), "manifest.json")
    if not os.path.exists(path):
        sys.stderr.write("no such run: %s\n" % run_id)
        sys.exit(21)  # not 2 — argparse already owns 2 for usage errors
    with open(path, "r", encoding="utf-8") as fh:
        m = json.load(fh)
    if m.get("schema") != SCHEMA:
        sys.stderr.write(
            "unsupported schema %r (expected %d) — halting rather than guessing\n"
            % (m.get("schema"), SCHEMA)
        )
        sys.exit(3)
    return m


def cmd_init(args):
    run_id = uuid.uuid4().hex[:12]
    d = run_dir(run_id)
    os.makedirs(os.path.join(d, "locks"), exist_ok=True)
    manifest = {
        "schema": SCHEMA,
        "run_id": run_id,
        "goal": args.goal,
        "budget_tokens": args.budget,
        "status": "active",
        "created_at": now_ts(),
    }
    with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    for name in ("queue.jsonl", "journal.jsonl", "parked.jsonl", "ledger.jsonl"):
        open(os.path.join(d, name), "a", encoding="utf-8").close()
    print(run_id)


def cmd_status(args):
    print(json.dumps(read_manifest(args.run), indent=2))


def main():
    p = argparse.ArgumentParser(prog="gstack-run")
    sub = p.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("init")
    pi.add_argument("--goal", required=True)
    pi.add_argument("--budget", type=int, required=True)
    pi.set_defaults(func=cmd_init)

    ps = sub.add_parser("status")
    ps.add_argument("--run", required=True)
    ps.set_defaults(func=cmd_status)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-cli.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-run test/run-cli.test.ts
git commit -m "feat(run): run state foundation with schema gating"
```

---

### Task 2: Queue — atomic claim, done, and stale reclaim

**Files:**
- Modify: `bin/gstack-run`
- Test: `test/run-queue.test.ts`

**Interfaces:**
- Consumes: `run_dir()`, `read_manifest()`, `now_ts()` from Task 1.
- Produces: `gstack-run add --run <id> --title <text>` prints a new `item_id`. `gstack-run claim --run <id> --worker <name>` prints JSON `{"item_id","title"}` or exits 4 with `no claimable items` on stderr. `gstack-run done --run <id> --item <item_id>` exits 0. Lock files live at `<run>/locks/<item_id>.lock` containing `{"worker","heartbeat"}`. Stale threshold is `GSTACK_LOCK_TTL_SEC`, default 900.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-q-'));
}
function run(args: string[], root: string, extra: Record<string, string> = {}) {
  const out = spawnSync([PY, RUN, ...args], {
    env: { ...process.env, GSTACK_STATE_ROOT: root, ...extra },
  });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run queue', () => {
  test('an item can be claimed once, and not twice', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['add', '--run', runId, '--title', 'first job'], root);

    const a = run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(a.code).toBe(0);
    expect(JSON.parse(a.stdout).title).toBe('first job');

    const b = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(b.code).toBe(4);
    expect(b.stderr).toContain('no claimable items');
  });

  test('a stale lock is reclaimed so a dead worker does not strand the item', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemId = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);

    // Age the heartbeat past the TTL.
    const lock = path.join(root, 'runs', runId, 'locks', `${itemId}.lock`);
    const data = JSON.parse(fs.readFileSync(lock, 'utf-8'));
    data.heartbeat = '2000-01-01T00:00:00+00:00';
    fs.writeFileSync(lock, JSON.stringify(data));

    const again = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).item_id).toBe(itemId);
  });

  test('done removes the item from the claimable set', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const itemId = run(['add', '--run', runId, '--title', 'job'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(run(['done', '--run', runId, '--item', itemId], root).code).toBe(0);

    // Even with the lock gone, a completed item is never handed out again.
    fs.rmSync(path.join(root, 'runs', runId, 'locks', `${itemId}.lock`), { force: true });
    expect(run(['claim', '--run', runId, '--worker', 'w3'], root).code).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-queue.test.ts`
Expected: FAIL — `add` is not a recognised subcommand, so argparse exits 2.

- [ ] **Step 3: Write minimal implementation**

Add to `bin/gstack-run` (imports `errno`, `time`):

```python
def append_jsonl(run_id, name, record):
    record.setdefault("ts", now_ts())
    path = os.path.join(run_dir(run_id), name)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")
    return record


def read_jsonl(run_id, name):
    path = os.path.join(run_dir(run_id), name)
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def lock_path(run_id, item_id):
    return os.path.join(run_dir(run_id), "locks", "%s.lock" % item_id)


def lock_ttl():
    return int(os.environ.get("GSTACK_LOCK_TTL_SEC", "900"))


def lock_is_stale(path):
    """Has this lock expired?

    The heartbeat inside the file is authoritative. When the file cannot be
    parsed we fall back to its age, and a file younger than the TTL is NEVER
    stale: a lock is empty for a moment between the O_EXCL create that commits
    ownership and the heartbeat write that follows, and without the age guard
    a concurrent reaper reads that empty file, calls it abandoned, and deletes
    a lock its owner is actively holding. Only an unparseable file OLDER than
    the TTL is treated as abandoned, rather than allowed to strand work
    forever.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            hb = json.load(fh).get("heartbeat")
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(hb)).total_seconds()
        return age > lock_ttl()
    except FileNotFoundError:
        return False
    except Exception:
        try:
            st = os.stat(path)
        except FileNotFoundError:
            return False
        except OSError:
            # Cannot judge this file right now (e.g. a Windows sharing
            # violation). Report it live rather than stale: refusing to reap
            # an abandoned lock merely delays reclaim until the next pass,
            # whereas deleting a lock someone is holding hands the same item
            # to two workers.
            return False
        return (time.time() - st.st_mtime) > lock_ttl()


def reap_stale_locks(run_id):
    """Delete lock files whose heartbeat has expired.

    Idempotent and ownership-free: two workers reaping the same lock is
    harmless, because deleting a lock grants nobody the item. Whoever then
    wins the O_EXCL create in try_lock owns it.
    """
    d = os.path.join(run_dir(run_id), "locks")
    try:
        names = os.listdir(d)
    except FileNotFoundError:
        return
    for name in names:
        if not name.endswith(".lock"):
            continue
        p = os.path.join(d, name)
        if lock_is_stale(p):
            try:
                os.unlink(p)
            except OSError:
                pass  # someone else reaped it, or it is briefly locked on Windows


def try_lock(run_id, item_id, worker):
    """Acquire an item. Correct by construction: an O_EXCL create is the ONLY
    way to acquire, and it is atomic, so two workers can never both win.

    Expired locks are cleared separately by reap_stale_locks(), which grants
    no ownership — it only deletes. Earlier designs tried to steal a stale lock
    in place (check, unlink, recreate); that is three syscalls with gaps, and
    two revisions failed to close the resulting double-claim window. Reaping and
    acquiring are kept apart precisely so acquisition stays a single atomic act.
    """
    path = lock_path(run_id, item_id)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except OSError as e:
        if e.errno != errno.EEXIST:
            raise
        return False
    with os.fdopen(fd, "w") as fh:
        fh.write(json.dumps({"worker": worker, "heartbeat": now_ts()}))
    return True


def open_items(run_id):
    """Items added but not done, newest status wins."""
    status = {}
    titles = {}
    for rec in read_jsonl(run_id, "queue.jsonl"):
        iid = rec["item_id"]
        if rec["event"] == "add":
            titles[iid] = rec["title"]
        status[iid] = rec["event"]
    return [(i, titles.get(i, "")) for i, s in status.items() if s != "done"]


def cmd_add(args):
    read_manifest(args.run)
    item_id = uuid.uuid4().hex[:10]
    append_jsonl(args.run, "queue.jsonl",
                 {"event": "add", "item_id": item_id, "title": args.title})
    print(item_id)


def cmd_claim(args):
    read_manifest(args.run)
    for item_id, title in open_items(args.run):
        if try_lock(args.run, item_id, args.worker):
            append_jsonl(args.run, "queue.jsonl",
                         {"event": "claim", "item_id": item_id, "worker": args.worker})
            print(json.dumps({"item_id": item_id, "title": title}))
            return
    sys.stderr.write("no claimable items\n")
    sys.exit(4)


def cmd_done(args):
    read_manifest(args.run)
    append_jsonl(args.run, "queue.jsonl",
                 {"event": "done", "item_id": args.item})
    try:
        os.unlink(lock_path(args.run, args.item))
    except FileNotFoundError:
        pass
```

Register in `main()`:

```python
    pa = sub.add_parser("add")
    pa.add_argument("--run", required=True)
    pa.add_argument("--title", required=True)
    pa.set_defaults(func=cmd_add)

    pc = sub.add_parser("claim")
    pc.add_argument("--run", required=True)
    pc.add_argument("--worker", required=True)
    pc.set_defaults(func=cmd_claim)

    pd = sub.add_parser("done")
    pd.add_argument("--run", required=True)
    pd.add_argument("--item", required=True)
    pd.set_defaults(func=cmd_done)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-queue.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-run test/run-queue.test.ts
git commit -m "feat(run): atomic claim with TTL reclaim so a dead worker cannot strand work"
```

---

### Task 3: Journal — verdicts, evidence, and supersession

**Files:**
- Modify: `bin/gstack-run`
- Test: `test/run-journal.test.ts`

**Interfaces:**
- Consumes: `append_jsonl()`, `read_jsonl()`, `read_manifest()` from Tasks 1-2.
- Produces: `gstack-run journal --run <id> --item <item_id> --claim <text> --verdict PROVEN|UNPROVEN|CONTRADICTED --evidence <text> [--supersedes <entry_id>]` prints the new `entry_id`. `gstack-run history --run <id> --item <item_id>` prints a JSON array, each entry gaining `"superseded_by"` when a later entry supersedes it.

This is the component that makes the founder's keep-everything memory decision safe: a contradicted claim is returned *with* its contradiction attached rather than standing alone.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-j-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run journal', () => {
  test('verdict defaults to recorded value and history returns it', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;

    const e = run(['journal', '--run', runId, '--item', item, '--claim', 'guard blocks edits',
                   '--verdict', 'PROVEN', '--evidence', 'edit denied by hook'], root);
    expect(e.code).toBe(0);

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    expect(h.length).toBe(1);
    expect(h[0].verdict).toBe('PROVEN');
    expect(h[0].evidence).toBe('edit denied by hook');
  });

  test('a superseding entry links back so the stale claim never stands alone', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;

    const first = run(['journal', '--run', runId, '--item', item, '--claim', 'CSP is fixed',
                       '--verdict', 'PROVEN', '--evidence', 'header changed'], root).stdout;
    const second = run(['journal', '--run', runId, '--item', item, '--claim', 'CSP is fixed',
                        '--verdict', 'CONTRADICTED', '--evidence', 'console shows 5 blocked scripts',
                        '--supersedes', first], root).stdout;

    const h = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    const older = h.find((x: any) => x.entry_id === first);
    const newer = h.find((x: any) => x.entry_id === second);
    expect(older.superseded_by).toBe(second);
    expect(newer.verdict).toBe('CONTRADICTED');
  });

  test('an invalid verdict is rejected', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 't'], root).stdout;
    const bad = run(['journal', '--run', runId, '--item', item, '--claim', 'c',
                     '--verdict', 'PROBABLY', '--evidence', 'e'], root);
    expect(bad.code).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-journal.test.ts`
Expected: FAIL — `journal` is not a recognised subcommand.

- [ ] **Step 3: Write minimal implementation**

```python
VERDICTS = ("PROVEN", "UNPROVEN", "CONTRADICTED")


def cmd_journal(args):
    read_manifest(args.run)
    if args.verdict not in VERDICTS:
        sys.stderr.write("verdict must be one of %s\n" % (VERDICTS,))
        sys.exit(5)
    entry_id = uuid.uuid4().hex[:10]
    append_jsonl(args.run, "journal.jsonl", {
        "entry_id": entry_id,
        "item_id": args.item,
        "claim": args.claim,
        "verdict": args.verdict,
        "evidence": args.evidence,
        "supersedes": args.supersedes,
    })
    print(entry_id)


def cmd_history(args):
    read_manifest(args.run)
    entries = [e for e in read_jsonl(args.run, "journal.jsonl")
               if e["item_id"] == args.item]
    # Attach the reverse link so a superseded claim is never returned alone.
    by_id = {e["entry_id"]: e for e in entries}
    for e in entries:
        target = e.get("supersedes")
        if target and target in by_id:
            by_id[target]["superseded_by"] = e["entry_id"]
    print(json.dumps(entries, indent=2))
```

Register in `main()`:

```python
    pj = sub.add_parser("journal")
    pj.add_argument("--run", required=True)
    pj.add_argument("--item", required=True)
    pj.add_argument("--claim", required=True)
    pj.add_argument("--verdict", required=True)
    pj.add_argument("--evidence", required=True)
    pj.add_argument("--supersedes", default=None)
    pj.set_defaults(func=cmd_journal)

    ph = sub.add_parser("history")
    ph.add_argument("--run", required=True)
    ph.add_argument("--item", required=True)
    ph.set_defaults(func=cmd_history)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-journal.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-run test/run-journal.test.ts
git commit -m "feat(run): journal verdicts with supersession links"
```

---

### Task 4: Park — blocked approvals that never block the run

**Files:**
- Modify: `bin/gstack-run`
- Test: `test/run-park.test.ts`

**Interfaces:**
- Consumes: `append_jsonl()`, `read_jsonl()`, `cmd_done` behaviour from Tasks 1-3.
- Produces: `gstack-run park --run <id> --item <item_id> --action <text> --reason <text>` exits 0 and releases the item's lock. `gstack-run parked --run <id>` prints a JSON array of parked records. A parked item is **not** claimable again in the same run.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-p-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run park', () => {
  test('parking one item leaves the others claimable', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const blocked = run(['add', '--run', runId, '--title', 'push to main'], root).stdout;
    run(['add', '--run', runId, '--title', 'independent work'], root);

    run(['claim', '--run', runId, '--worker', 'w1'], root);
    expect(run(['park', '--run', runId, '--item', blocked,
                '--action', 'git push origin main',
                '--reason', 'needs founder approval'], root).code).toBe(0);

    // The run continues: the other item is still claimable.
    const next = run(['claim', '--run', runId, '--worker', 'w2'], root);
    expect(next.code).toBe(0);
    expect(JSON.parse(next.stdout).title).toBe('independent work');
  });

  test('a parked item is never handed out again', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    const only = run(['add', '--run', runId, '--title', 'deploy prod'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['park', '--run', runId, '--item', only, '--action', 'deploy', '--reason', 'prod'], root);

    expect(run(['claim', '--run', runId, '--worker', 'w2'], root).code).toBe(4);

    const parked = JSON.parse(run(['parked', '--run', runId], root).stdout);
    expect(parked.length).toBe(1);
    expect(parked[0].action).toBe('deploy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-park.test.ts`
Expected: FAIL — `park` is not a recognised subcommand.

- [ ] **Step 3: Write minimal implementation**

```python
def cmd_park(args):
    read_manifest(args.run)
    append_jsonl(args.run, "parked.jsonl", {
        "item_id": args.item,
        "action": args.action,
        "reason": args.reason,
    })
    # Mark it terminal in the queue so the run continues past it.
    append_jsonl(args.run, "queue.jsonl", {"event": "done", "item_id": args.item})
    try:
        os.unlink(lock_path(args.run, args.item))
    except FileNotFoundError:
        pass


def cmd_parked(args):
    read_manifest(args.run)
    print(json.dumps(read_jsonl(args.run, "parked.jsonl"), indent=2))
```

Register in `main()`:

```python
    pp = sub.add_parser("park")
    pp.add_argument("--run", required=True)
    pp.add_argument("--item", required=True)
    pp.add_argument("--action", required=True)
    pp.add_argument("--reason", required=True)
    pp.set_defaults(func=cmd_park)

    pl = sub.add_parser("parked")
    pl.add_argument("--run", required=True)
    pl.set_defaults(func=cmd_parked)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-park.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-run test/run-park.test.ts
git commit -m "feat(run): park blocked approvals without stalling the run"
```

---

### Task 5: Budget ledger — record and check spend

**Files:**
- Modify: `bin/gstack-run`
- Test: `test/run-budget.test.ts`

**Interfaces:**
- Consumes: `append_jsonl()`, `read_jsonl()`, `read_manifest()` from Tasks 1-3.
- Produces: `gstack-run budget-record --run <id> --agent <name> --phase <name> --tokens <int>` exits 0. `gstack-run budget-check --run <id>` prints JSON `{"spent","budget","remaining","exhausted"}` and exits 0 when under budget, 6 when exhausted.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-b-')); }
function run(args: string[], root: string) {
  const out = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: out.exitCode, stdout: out.stdout.toString().trim(), stderr: out.stderr.toString().trim() };
}

describe('gstack-run budget', () => {
  test('spend accumulates and remaining falls', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    run(['budget-record', '--run', runId, '--agent', 'w1', '--phase', 'work', '--tokens', '400'], root);
    run(['budget-record', '--run', runId, '--agent', 'w2', '--phase', 'verify', '--tokens', '100'], root);

    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(0);
    const b = JSON.parse(c.stdout);
    expect(b.spent).toBe(500);
    expect(b.remaining).toBe(500);
    expect(b.exhausted).toBe(false);
  });

  test('crossing the ceiling reports exhausted with a distinct exit code', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'g', '--budget', '100'], root).stdout;
    run(['budget-record', '--run', runId, '--agent', 'w1', '--phase', 'work', '--tokens', '150'], root);

    const c = run(['budget-check', '--run', runId], root);
    expect(c.code).toBe(6);
    const b = JSON.parse(c.stdout);
    expect(b.exhausted).toBe(true);
    expect(b.remaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-budget.test.ts`
Expected: FAIL — `budget-record` is not a recognised subcommand.

- [ ] **Step 3: Write minimal implementation**

```python
def budget_state(run_id):
    m = read_manifest(run_id)
    spent = sum(int(r.get("tokens", 0)) for r in read_jsonl(run_id, "ledger.jsonl"))
    budget = int(m["budget_tokens"])
    remaining = max(0, budget - spent)
    return {
        "spent": spent,
        "budget": budget,
        "remaining": remaining,
        "exhausted": spent >= budget,
    }


def cmd_budget_record(args):
    read_manifest(args.run)
    append_jsonl(args.run, "ledger.jsonl", {
        "agent": args.agent, "phase": args.phase, "tokens": args.tokens,
    })


def cmd_budget_check(args):
    state = budget_state(args.run)
    print(json.dumps(state, indent=2))
    sys.exit(6 if state["exhausted"] else 0)
```

Register in `main()`:

```python
    pbr = sub.add_parser("budget-record")
    pbr.add_argument("--run", required=True)
    pbr.add_argument("--agent", required=True)
    pbr.add_argument("--phase", required=True)
    pbr.add_argument("--tokens", type=int, required=True)
    pbr.set_defaults(func=cmd_budget_record)

    pbc = sub.add_parser("budget-check")
    pbc.add_argument("--run", required=True)
    pbc.set_defaults(func=cmd_budget_check)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-budget.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-run test/run-budget.test.ts
git commit -m "feat(run): token ledger with a hard ceiling"
```

---

### Task 6: Budget guard — the PreToolUse hook that actually stops spend

**Files:**
- Create: `bin/gstack-budget-guard`
- Test: `test/run-budget-guard.test.ts`

**Interfaces:**
- Consumes: `budget_state()` semantics from Task 5 (re-implemented by reading the same files — the hook must not import from `gstack-run`, so it stays a standalone script that a hook runner can execute).
- Produces: reads a `PreToolUse` payload on stdin. When `GSTACK_ACTIVE_RUN` is unset, prints nothing and exits 0 (no active run, nothing to enforce). When the run is under budget, emits an allow decision. When exhausted **or when spend cannot be determined**, emits a deny decision.

The deny shape is the one this harness actually reads. A flat `{"permissionDecision": ...}` is ignored, which is how a previous guard shipped inert:

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}
```

Budget enforcement fails **closed** — unlike detection guards, which fail open. Overspending cannot be undone; a paused run can be resumed.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const GUARD = path.join(ROOT, 'bin', 'gstack-budget-guard');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-bg-')); }
function cli(args: string[], root: string) {
  const o = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return o.stdout.toString().trim();
}
function guard(root: string, runId: string | undefined) {
  const env: Record<string, string> = { ...process.env, GSTACK_STATE_ROOT: root };
  if (runId) env.GSTACK_ACTIVE_RUN = runId;
  const o = spawnSync([PY, GUARD], {
    env,
    stdin: Buffer.from(JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' },
    })),
  });
  return { code: o.exitCode, stdout: o.stdout.toString().trim() };
}

describe('gstack-budget-guard', () => {
  test('ALLOWS work while under budget', () => {
    const root = tmpRoot();
    const runId = cli(['init', '--goal', 'g', '--budget', '1000'], root);
    cli(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '10'], root);

    const out = guard(root, runId);
    expect(out.code).toBe(0);
    const d = JSON.parse(out.stdout);
    expect(d.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  test('DENIES work once the ceiling is crossed', () => {
    const root = tmpRoot();
    const runId = cli(['init', '--goal', 'g', '--budget', '100'], root);
    cli(['budget-record', '--run', runId, '--agent', 'w', '--phase', 'work', '--tokens', '500'], root);

    const out = guard(root, runId);
    const d = JSON.parse(out.stdout);
    expect(d.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(d.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(d.hookSpecificOutput.permissionDecisionReason).toContain('budget');
  });

  test('fails CLOSED when spend cannot be determined', () => {
    const root = tmpRoot();
    const runId = cli(['init', '--goal', 'g', '--budget', '100'], root);
    fs.rmSync(path.join(root, 'runs', runId, 'manifest.json'), { force: true });

    const d = JSON.parse(guard(root, runId).stdout);
    expect(d.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('is inert when no run is active', () => {
    const root = tmpRoot();
    const out = guard(root, undefined);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-budget-guard.test.ts`
Expected: FAIL — `bin/gstack-budget-guard` does not exist.

- [ ] **Step 3: Write minimal implementation**

```python
#!/usr/bin/env python3
"""gstack-budget-guard — PreToolUse hook enforcing an unattended run's token ceiling.

A budget that asks nicely is not a budget. This runs on every tool call, so a
runaway loop is stopped by the next call rather than by a periodic sweep that
may never arrive.

Enforcement direction: budget FAILS CLOSED. Detection guards fail open (a guard
that blocks work when it malfunctions gets disabled, and then guards nothing),
but overspending cannot be undone while a paused run can be resumed.

Active only when GSTACK_ACTIVE_RUN is set; otherwise silent and inert.

Output shape matters. This harness reads ONLY:
    hookSpecificOutput.hookEventName == "PreToolUse"
    hookSpecificOutput.permissionDecision
    hookSpecificOutput.permissionDecisionReason
A flat {"permissionDecision": ...} is silently ignored — that is how an earlier
guard shipped looking correct and blocking nothing.
"""
import json
import os
import sys


def emit(decision, reason=None):
    out = {"hookEventName": "PreToolUse", "permissionDecision": decision}
    if reason:
        out["permissionDecisionReason"] = reason
    sys.stdout.write(json.dumps({"hookSpecificOutput": out}))
    sys.exit(0)


def main():
    sys.stdin.read()  # drain payload; decision does not depend on it
    run_id = os.environ.get("GSTACK_ACTIVE_RUN")
    if not run_id:
        sys.exit(0)

    root = os.environ.get("GSTACK_STATE_ROOT") or os.path.join(
        os.path.expanduser("~"), ".gstack")
    d = os.path.join(root, "runs", run_id)

    try:
        with open(os.path.join(d, "manifest.json"), "r", encoding="utf-8") as fh:
            budget = int(json.load(fh)["budget_tokens"])
        spent = 0
        ledger = os.path.join(d, "ledger.jsonl")
        if os.path.exists(ledger):
            with open(ledger, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line:
                        spent += int(json.loads(line).get("tokens", 0))
    except Exception as e:
        emit("deny", "Run budget could not be determined (%s). Failing closed: "
                     "overspending cannot be undone, a paused run can be resumed." % e)

    if spent >= budget:
        emit("deny", "Run %s has reached its token budget (%d/%d). The run should "
                     "write its resume point and stop." % (run_id, spent, budget))
    emit("allow")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-budget-guard.test.ts`
Expected: PASS — all four tests green, including the allow case and the fail-closed case.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-budget-guard test/run-budget-guard.test.ts
git commit -m "feat(run): budget guard that fails closed, with paired allow/deny tests"
```

---

### Task 7: Risk classifier — a lookup table, deliberately not clever

**Files:**
- Create: `bin/gstack-risk-classify`
- Test: `test/run-risk-classify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `gstack-risk-classify --action <text>` prints `routine` or `elevated` and exits 0. Patterns are literal substrings held in one module-level list, `ELEVATED_PATTERNS`.

Model judgment about risk is exactly what failed on 2026-08-06 — every incorrect claim felt correct when made. This stays a table so it can be read, tested, and extended without re-reasoning.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const RC = path.join(ROOT, 'bin', 'gstack-risk-classify');
const PY = process.env.GSTACK_PY || 'python';

function classify(action: string) {
  const o = spawnSync([PY, RC, '--action', action]);
  return o.stdout.toString().trim();
}

describe('gstack-risk-classify', () => {
  test('elevated actions are caught', () => {
    expect(classify('git push origin main')).toBe('elevated');
    expect(classify('gh workflow run db-migrate.yml -f mode=apply')).toBe('elevated');
    expect(classify('rm -rf build')).toBe('elevated');
    expect(classify('edit ~/.claude/settings.json')).toBe('elevated');
  });

  test('routine actions are not inflated', () => {
    expect(classify('npx tsc --noEmit')).toBe('routine');
    expect(classify('bun test test/foo.test.ts')).toBe('routine');
    expect(classify('read server/app.ts')).toBe('routine');
  });

  test('classification is case-insensitive', () => {
    expect(classify('GIT PUSH origin main')).toBe('elevated');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-risk-classify.test.ts`
Expected: FAIL — `bin/gstack-risk-classify` does not exist.

- [ ] **Step 3: Write minimal implementation**

```python
#!/usr/bin/env python3
"""gstack-risk-classify — assigns an action a verification tier.

Returns "elevated" for actions where being wrong is expensive, "routine"
otherwise. Elevated claims get re-derived by a DIFFERENT agent from primary
sources; routine claims need only typecheck and tests.

This is a LOOKUP TABLE on purpose. Model judgment about risk is precisely what
failed on 2026-08-06 — every wrong claim felt correct when it was made. Keep it
dumb, readable and testable; extend the list rather than adding cleverness.

Usage:
    gstack-risk-classify --action "<command or description>"
"""
import argparse

ELEVATED_PATTERNS = [
    "git push",
    "force-push",
    "--force",
    "db-migrate",
    "mode=apply",
    "drop table",
    "delete from",
    "truncate",
    "rm -rf",
    "settings.json",
    "prod",
    "deploy",
    "gcloud run",
    "fly deploy",
    "send",
    "email",
    "secret",
    "credential",
]


def classify(action):
    low = action.lower()
    return "elevated" if any(p in low for p in ELEVATED_PATTERNS) else "routine"


def main():
    p = argparse.ArgumentParser(prog="gstack-risk-classify")
    p.add_argument("--action", required=True)
    args = p.parse_args()
    print(classify(args.action))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-risk-classify.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-risk-classify test/run-risk-classify.test.ts
git commit -m "feat(run): risk classifier as a lookup table, not model judgment"
```

---

### Task 8: Resume — the normal exit, not the emergency path

**Files:**
- Modify: `bin/gstack-run`
- Test: `test/run-cli.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `budget_state()`, `open_items()`, `read_jsonl()`, `read_manifest()` from Tasks 1-5.
- Produces: `gstack-run stop --run <id> --why queue-drained|budget-exhausted|breaker-tripped` writes `resume.json` and sets manifest `status` to `stopped`. `gstack-run report --run <id>` prints JSON `{"run_id","status","stopped_because","completed","parked","open","spent","budget"}`.

All three stop reasons write the same resume point. A recovery path used only in emergencies is a recovery path that is never tested.

- [ ] **Step 1: Write the failing test**

```typescript
describe('gstack-run stop/report', () => {
  test('stopping writes a resume point and the report separates done from open', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-r-'));
    const runId = run(['init', '--goal', 'g', '--budget', '1000'], root).stdout;
    const a = run(['add', '--run', runId, '--title', 'done job'], root).stdout;
    run(['add', '--run', runId, '--title', 'unfinished job'], root);
    run(['claim', '--run', runId, '--worker', 'w1'], root);
    run(['done', '--run', runId, '--item', a], root);

    const s = run(['stop', '--run', runId, '--why', 'budget-exhausted'], root);
    expect(s.code).toBe(0);
    expect(fs.existsSync(path.join(root, 'runs', runId, 'resume.json'))).toBe(true);

    const rep = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(rep.status).toBe('stopped');
    expect(rep.stopped_because).toBe('budget-exhausted');
    expect(rep.completed).toBe(1);
    expect(rep.open).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-cli.test.ts`
Expected: FAIL — `stop` is not a recognised subcommand.

- [ ] **Step 3: Write minimal implementation**

```python
def cmd_stop(args):
    m = read_manifest(args.run)
    remaining = [{"item_id": i, "title": t} for i, t in open_items(args.run)]
    resume = {
        "stopped_at": now_ts(),
        "stopped_because": args.why,
        "open_items": remaining,
        "budget": budget_state(args.run),
    }
    with open(os.path.join(run_dir(args.run), "resume.json"), "w", encoding="utf-8") as fh:
        json.dump(resume, fh, indent=2)
    m["status"] = "stopped"
    m["stopped_because"] = args.why
    with open(os.path.join(run_dir(args.run), "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(m, fh, indent=2)


def cmd_report(args):
    m = read_manifest(args.run)
    done_ids = {r["item_id"] for r in read_jsonl(args.run, "queue.jsonl")
                if r["event"] == "done"}
    parked = read_jsonl(args.run, "parked.jsonl")
    parked_ids = {p["item_id"] for p in parked}
    b = budget_state(args.run)
    print(json.dumps({
        "run_id": m["run_id"],
        "status": m["status"],
        "stopped_because": m.get("stopped_because"),
        "completed": len(done_ids - parked_ids),
        "parked": len(parked_ids),
        "open": len(open_items(args.run)),
        "spent": b["spent"],
        "budget": b["budget"],
    }, indent=2))
```

Register in `main()`:

```python
    pst = sub.add_parser("stop")
    pst.add_argument("--run", required=True)
    pst.add_argument("--why", required=True,
                     choices=["queue-drained", "budget-exhausted", "breaker-tripped"])
    pst.set_defaults(func=cmd_stop)

    prp = sub.add_parser("report")
    prp.add_argument("--run", required=True)
    prp.set_defaults(func=cmd_report)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/run-cli.test.ts`
Expected: PASS — the new block plus the two original tests.

- [ ] **Step 5: Commit**

```bash
git add bin/gstack-run test/run-cli.test.ts
git commit -m "feat(run): resume point and run report"
```

---

### Task 9: Acceptance — a falsified claim must be caught

**Files:**
- Create: `test/run-acceptance.test.ts`
- Create: `run-supervisor/SKILL.md.tmpl`

**Interfaces:**
- Consumes: every subcommand from Tasks 1-8, plus `gstack-risk-classify` from Task 7.
- Produces: `run-supervisor` skill documenting the worker loop. No new CLI surface.

This is the criterion that matters most. Tasks 1-8 prove the machinery runs; only this proves it catches the failure the runtime exists to prevent.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'bin', 'gstack-run');
const PY = process.env.GSTACK_PY || 'python';

function tmpRoot(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-a-')); }
function run(args: string[], root: string) {
  const o = spawnSync([PY, RUN, ...args], { env: { ...process.env, GSTACK_STATE_ROOT: root } });
  return { code: o.exitCode, stdout: o.stdout.toString().trim() };
}

describe('acceptance: a false claim of success cannot survive', () => {
  test('a worker reporting success it did not achieve is contradicted, and the report does not count it as complete', () => {
    const root = tmpRoot();
    const runId = run(['init', '--goal', 'ship the fix', '--budget', '10000'], root).stdout;
    const item = run(['add', '--run', runId, '--title', 'make the guard block edits'], root).stdout;
    run(['claim', '--run', runId, '--worker', 'lying-worker'], root);

    // The worker claims success without doing the work.
    const claimEntry = run(['journal', '--run', runId, '--item', item,
      '--claim', 'the guard now blocks edits to generated files',
      '--verdict', 'PROVEN', '--evidence', 'I am confident it works'], root).stdout;

    // An independent verifier re-derives from a primary source and disagrees.
    run(['journal', '--run', runId, '--item', item,
      '--claim', 'the guard now blocks edits to generated files',
      '--verdict', 'CONTRADICTED',
      '--evidence', 'live Edit on a generated file succeeded; file bytes changed on disk',
      '--supersedes', claimEntry], root);

    const history = JSON.parse(run(['history', '--run', runId, '--item', item], root).stdout);
    const original = history.find((h: any) => h.entry_id === claimEntry);

    // The false claim never stands alone.
    expect(original.superseded_by).toBeTruthy();
    expect(history.some((h: any) => h.verdict === 'CONTRADICTED')).toBe(true);

    // And it is parked for a human rather than silently reported done.
    run(['park', '--run', runId, '--item', item,
      '--action', 'make the guard block edits',
      '--reason', 'verification returned CONTRADICTED'], root);
    run(['stop', '--run', runId, '--why', 'queue-drained'], root);

    const report = JSON.parse(run(['report', '--run', runId], root).stdout);
    expect(report.completed).toBe(0);
    expect(report.parked).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/run-acceptance.test.ts`
Expected: FAIL if any of Tasks 1-8 are incomplete. If Tasks 1-8 are done, this test should PASS on first run — it composes existing behaviour rather than adding any. Should it fail, the defect is in `cmd_report`'s completed/parked accounting, not in this test.

- [ ] **Step 3: Write the supervisor skill**

Create `run-supervisor/SKILL.md.tmpl`:

```markdown
---
name: run-supervisor
version: 0.1.0
description: |
  Worker loop for unattended gstack runs. Claims one item at a time from a run
  directory, does the work, gets it verified, records the verdict, then parks or
  completes it. Holds no state of its own — killing this mid-item is safe,
  because the next session resumes from the run's files.
  Use when asked to "start an unattended run", "work the queue", or "resume run
  <id>". (gstack)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
---

{{PREAMBLE}}

# /run-supervisor — the unattended worker loop

Set `GSTACK_ACTIVE_RUN` to the run id for this session so the budget guard
applies. Then repeat until `claim` exits 4:

## Step 1: Claim

```bash
~/.claude/skills/gstack/bin/gstack-run claim --run "$RUN" --worker "$SESSION"
```

Exit 4 means the queue is drained — go to Step 6.

## Step 2: Do the work

Do the item. Every tool call passes the budget guard; if it denies, go to Step 6
with `--why budget-exhausted`.

## Step 3: Classify

```bash
~/.claude/skills/gstack/bin/gstack-risk-classify --action "<what you did>"
```

## Step 4: Verify

- `routine` — run the project's typecheck and tests.
- `elevated` — dispatch a **different** agent to re-derive the result from
  primary sources: re-run the command, read the file from disk, query the live
  object. Brief it with the domain facts it needs, not just the task. A verifier
  that reads your report and agrees has verified nothing.

## Step 5: Record, then park or complete

```bash
~/.claude/skills/gstack/bin/gstack-run journal --run "$RUN" --item "$ITEM" \
  --claim "<what you assert>" --verdict PROVEN|UNPROVEN|CONTRADICTED \
  --evidence "<what you observed>"
```

`CONTRADICTED` gets exactly one requeue, and the retry brief must carry the
contradicting evidence — otherwise the second attempt repeats the first's
reasoning and reaches the same wrong answer. After that, park it.

Park anything needing founder approval; the run continues past it.

## Step 6: Stop

```bash
~/.claude/skills/gstack/bin/gstack-run stop --run "$RUN" --why <reason>
~/.claude/skills/gstack/bin/gstack-run report --run "$RUN"
```

A run may end early. It may never report success it did not achieve.
```

- [ ] **Step 4: Regenerate and run the full suite**

Run: `bun run scripts/gen-skill-docs.ts --catalog-mode=full`
Then: `bun test test/run-acceptance.test.ts`
Expected: generation reports 60 skills (59 + `run-supervisor`); the acceptance test passes.

Regenerating bare would collapse every description to one line — always pass `--catalog-mode=full`.

- [ ] **Step 5: Commit**

```bash
git add bin/ test/ run-supervisor/ docs/design/2026-08-07-core-runtime-plan.md
git commit -m "feat(run): supervisor skill and the falsified-claim acceptance test"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

| Spec section | Task |
|---|---|
| State layout | 1 |
| Lifecycle | 1, 2, 8 |
| `gstack-run` | 1-5, 8 |
| `run-supervisor` | 9 |
| `risk-classify` | 7 |
| `verify-dispatch` | 9 (Step 4 of the skill) |
| Budget hook | 6 |
| Data flow | 2, 3, 4 |
| Error handling — stale lock | 2 |
| Error handling — CONTRADICTED | 3, 9 |
| Error handling — ceiling | 5, 6, 8 |
| Error handling — unreadable state | 1 (schema halt), 6 (fail closed) |
| Testing — paired block/allow | 6 |
| Documented bet — supersession | 3 |
| Acceptance criteria 1-6 | 2, 8, 9 |

Two spec items are deliberately **not** separate tasks: the circuit breaker already exists as `bin/gstack-failure-count` and is referenced by the supervisor rather than rebuilt; and `verify-dispatch` is a documented step in the supervisor skill rather than a CLI, because spawning a subagent is a harness capability, not a shell command.

**2. Placeholder scan** — no `TBD`, `TODO`, "add error handling", or "similar to Task N". Every code step contains runnable code; every test step contains the actual assertions.

**3. Type consistency** — verified across tasks: `run_dir()`, `read_manifest()`, `append_jsonl()`, `read_jsonl()`, `budget_state()`, `open_items()`, `lock_path()` are defined in Tasks 1-5 and used with identical names and signatures in Tasks 2-8. Exit codes are distinct and non-overlapping: 21 = no such run (moved off 2, which argparse owns for usage errors), 3 = bad schema, 4 = no claimable items, 5 = bad verdict, 6 = budget exhausted.
