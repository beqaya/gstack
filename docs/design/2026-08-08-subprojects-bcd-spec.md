# Sub-projects B, C and D — specs

Date: 2026-08-08
Status: written after sub-project A (core runtime) shipped and was dogfooded three times.
Not started. Each gets its own plan → build → review cycle.

Sub-project A is the engine: a run is a directory, workers claim items with atomic
locks, `done` refuses anything not verified `PROVEN`, elevated work is derived from
touched paths and needs an independent verifier, and blocked items park for the
founder instead of stalling the run. 72 tests. See
`2026-08-07-core-runtime-design.md` and `-followups.md`.

B, C and D all execute ON A. None of them is a new engine.

---

# B — Development army

## The correction that defines this sub-project

"Army" implies hiring. Nothing needs hiring. The gstack suite already contains
18 skills that map onto software delivery roles:

| Stage | Existing skills |
|---|---|
| Shape the idea | `office-hours`, `spec` |
| Review the plan | `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `plan-devex-review`, `autoplan` |
| Build and check | `qa`, `qa-only`, `review`, `codex`, `health` |
| Ship | `ship`, `land-and-deploy`, `canary` |
| Maintain | `document-generate`, `document-release`, `retro` |

B is **routing**, not authorship: teaching the runtime that a work item of a given
kind runs a given sequence of those skills, with A's verification between steps.

## Scope

1. **Item kinds.** A queue item gains a kind — `feature`, `bug`, `refactor`,
   `docs`, `incident`. The kind selects a pipeline.
2. **Pipelines as data, not prose.** Each kind maps to an ordered list of skills.
   Held in one readable table, extended by adding a row — the same discipline as
   `risk-classify`, and for the same reason: judgment about which stage comes next
   is exactly the thing that drifts when a model improvises it.
3. **Stage results feed A.** Each stage's output becomes a journal entry with its
   own verdict. A stage that cannot show evidence is `UNPROVEN`, and `done` already
   refuses to close on that.
4. **Parking mid-pipeline.** A stage that needs founder approval (`ship` creating a
   PR, `land-and-deploy` merging) parks the item with the pipeline position
   recorded, so resuming continues from that stage rather than restarting.

## Explicitly NOT in scope

- Writing new skills. If a stage is missing, that is a finding, not a licence.
- Parallel agents on one item. A's locks give one worker per item deliberately.
- Replacing `autoplan`. It already chains the four plan reviews; B calls it.

## Acceptance criteria

1. A `feature` item runs spec → plan review → build → qa → review → ship, and every
   stage transition is visible in `history`.
2. A stage that fails verification stops the pipeline and parks the item — it does
   not proceed to the next stage.
3. A parked mid-pipeline item resumes at the stage it stopped at, proven by killing
   the session between stages.
4. A `docs` item does not run `qa` — pipelines actually differ by kind.
5. The pipeline table is data. Adding a kind requires no code change.

## Dependencies and risk

Needs A only. The real risk is scope: "army" invites building an org chart. The
mitigation is criterion 5 — if a change needs code rather than a table row, it is
probably scope creep.

---

# C — Cybersecurity department

## The correction that defines this sub-project

I twice described this as "build a security department" and then as "finish the
cyberteam suite, Wave 0+1, 7 skills". **Both were wrong.** The suite at
`~/.claude/skills/cyberteam/` contains **61 skills** — advisory, appsec, asm,
audit-prep, audit-response, awareness-content, bcp-dr, biso, breach-response,
cloud-security, compliance-map, config-baseline, crypto-pki, cti-strategic and
more — plus `bin/`, `kb/`, `templates/`, `conventions/` and `tests/`.

The content largely exists. What does not exist is any connection between it and
the runtime, or between it and gstack's single `cso` skill.

C is therefore **integration and gap-closing**, not authorship.

## Scope

1. **Inventory against a role model.** Map the 61 skills onto the functions a
   security department actually performs (governance, risk, compliance, AppSec,
   cloud, detection, response, awareness, third-party, BCDR). Produce the coverage
   map and, more importantly, the gaps.
2. ~~**Resolve the `cso` overlap.**~~ **CORRECTED by the founder 2026-08-08: there
   is no overlap to resolve.** `cso` belongs to the *development* team — it reviews
   the security of what we build, and stays in the dev pipelines. Cyberteam is a
   *separate practice* with its own clients and deliverables. They serve different
   audiences and both should exist. What C must avoid is the two colliding in the
   pipeline table, which is why cyber kinds are namespaced (see below).
3. **Wire into A.** Security work becomes runnable as run items with pipelines,
   like B's — an `incident` kind, an `audit` kind, a `review` kind.
4. **Evidence discipline.** Security findings are claims about a system's state.
   They get journal verdicts with evidence like everything else. A finding whose
   evidence is "the model believed it" is `UNPROVEN` and cannot close.

## Explicitly NOT in scope

- Rewriting the 61 skills. Read before proposing changes.
- KSA/NCA regulatory content decisions — founder domain, not mine.
- Merging cyberteam into gstack. They are separate suites; C connects them.

## Built so far (2026-08-08)

Eight namespaced engagement pipelines are in `gstack-pipeline`, their stages
naming real cyberteam skills: `cyber:assessment`, `cyber:audit`,
`cyber:incident`, `cyber:pentest`, `cyber:vciso`, `cyber:vendor`,
`cyber:threat`, `cyber:privacy`.

The `cyber:` prefix is load-bearing. `incident` already means something else
on the dev side (investigate -> build -> ship -> canary) and cyberteam's
incident is triage -> forensics -> breach-response. Two kinds sharing one
name is the collision class this suite was already bitten by.

A test resolves every cyber stage against
`~/.claude/skills/cyberteam/skills/<stage>/SKILL.md` on disk. A pipeline that
named a non-existent skill would send a worker to run nothing, and the stage
would look complete because nothing failed.

Still to do: the coverage map (item 1), and evidence discipline for findings
(item 4).

## Acceptance criteria

1. A coverage map exists naming, per department function, which skill covers it or
   that none does.
2. Every routing collision between `cso` and a cyberteam skill is resolved, with one
   skill owning each phrase.
3. An `incident` run item executes a cyberteam pipeline end to end under A.
4. A security finding without evidence cannot be closed as done.

## Dependencies and risk

Needs A. Benefits from B's pipeline machinery — do B first, or C will build a worse
version of it. The main risk is duplicating work already sitting in those 61 skills
because nobody read them first; criterion 1 exists to force that reading.

---

# D — Self-enhancement

## Why this is last, and genuinely cannot be earlier

D measures the system's own performance. Today there is nothing to measure: three
runs exist, all against gstack's own repo, all small. Building D now would produce
a scoreboard with no game played — precise-looking numbers derived from nothing,
which is the exact failure this whole project was built to prevent.

D becomes possible once A/B/C have produced runs across real work.

## Scope

1. **Read what A already records.** Every run writes verdicts, evidence, spend per
   agent and phase, parked items, and stop reasons. D is primarily analysis of
   existing data, not new instrumentation.
2. **Metrics that would change a decision.** Not vanity counts. Candidates:
   - verification cost ratio (today: one item cost 21k to do and 63k to verify — is
     that typical, and where is it worth paying?)
   - `CONTRADICTED` rate per stage — which stages produce claims that do not survive
   - park rate by action kind — what keeps needing the founder, and could a standing
     authorisation remove it
   - resume rate — how often runs stop early, and why
3. **Feed findings back as work items.** A metric that identifies a weak stage
   should produce a queue item, not a chart nobody reads.
4. **Honest about what cannot be measured.** Token spend is currently self-reported
   by the worker; the harness knows the true figure and gstack does not. Any
   cost metric must be labelled as an estimate until that changes.

## Explicitly NOT in scope

- Automatic self-modification. D reports; humans and the normal build cycle act.
- Dashboards. A report on demand beats a UI nobody opens.
- Replacing `/reflect` or `/retro`. D covers *runs*; those cover *sessions* and
  *commits*.

## Acceptance criteria

1. Given a set of completed runs, D produces per-metric figures with the run ids
   they came from, so any number can be traced to its source.
2. At least one metric identifies something actionable that was not already known.
3. Every estimated figure is labelled as estimated.
4. D's own claims carry verdicts — it is subject to the same evidence rule.

## Dependencies

Needs A, plus real usage. Do not start D until at least a few dozen runs exist
across work that gstack did not author.

---

# Suggested order, and the reasoning

**B → C → D**, with real usage between each.

B multiplies everything: it turns A from a queue into something that ships features,
and it builds the pipeline machinery C would otherwise reinvent. C is mostly
integration once B exists. D needs the data the first two generate.

The strongest argument for this order is what happened today: every finding of
consequence came from *running* the system, not from planning it. Each sub-project
should be used on real work before the next begins.
