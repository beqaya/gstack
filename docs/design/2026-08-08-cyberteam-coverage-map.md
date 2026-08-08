# Cyberteam coverage map — what the 61 skills cover, and what they don't

Date: 2026-08-08
Deliverable: sub-project C, acceptance criterion 1.
Source: `~/.claude/skills/cyberteam/skills/` — 61 skills, each a directory with a `SKILL.md`.

Purpose: before anyone proposes writing a new security skill, this says whether one
already exists. The suite is large enough that the real risk is rebuilding something
that is already there.

**Note on scope.** Cyberteam is a *separate practice* from the development team.
gstack's own `cso` skill belongs to the dev pipelines — it reviews the security of
what we build. Nothing here replaces it, and the two are namespaced apart in
`gstack-pipeline` (`cyber:*` kinds).

## Coverage by department function

| Function | Skills |
|---|---|
| Governance & strategy | `vciso`, `biso`, `advisory`, `policy-review`, `maturity`, `posture`, `metrics`, `requirements`, `tech-advisor`, `solution-sme` |
| Risk | `risk-assessment`, `threat-model`, `insider-threat` |
| Compliance & audit | `compliance-map`, `soa`, `audit-prep`, `audit-response`, `soc-report`, `questionnaire`, `monthly-check` |
| Privacy & data | `privacy-dpia`, `data-security` |
| Application security | `appsec`, `security-review`, `security-architecture`, `vdp` |
| Cloud & infrastructure | `cloud-security`, `m365-security`, `network-security`, `config-baseline`, `ot-ics`, `crypto-pki` |
| Identity | `iam`, `iam-pam` |
| Attack surface & testing | `asm`, `pentest`, `red-team`, `purple-team`, `vuln-mgmt` |
| Detection & monitoring | `detection-eng`, `siem`, `soar`, `edr`, `threat-hunt` |
| Threat intelligence | `intel`, `cti-strategic` |
| Incident response | `incident`, `triage`, `breach-response`, `forensics`, `malware-analysis`, `tabletop` |
| Awareness | `awareness-content`, `phish` |
| Third party & supply chain | `vendor-risk`, `supply-chain`, `ma-security` |
| Resilience | `bcp-dr` |
| Email security | `email-security` |
| Commercial | `rfp` |
| Suite entry point | `cyber` |

That is 61 of 61 — every skill on disk is placed. A test in
`test/run-pipeline.test.ts` keeps the pipeline stages honest against the same
directory; this map is maintained by hand and should be re-checked whenever the
suite grows.

## Where the engagement pipelines draw from

Eight `cyber:*` kinds are wired in `gstack-pipeline`. They use 27 of the 61 skills:

| Kind | Stages |
|---|---|
| `cyber:assessment` | risk-assessment → maturity → soa → compliance-map → advisory |
| `cyber:audit` | audit-prep → questionnaire → soa → audit-response → soc-report |
| `cyber:incident` | triage → forensics → breach-response → incident |
| `cyber:pentest` | pentest → vuln-mgmt → security-review → advisory |
| `cyber:vciso` | posture → maturity → policy-review → metrics → advisory |
| `cyber:vendor` | vendor-risk → questionnaire → supply-chain → advisory |
| `cyber:threat` | intel → cti-strategic → threat-hunt → detection-eng |
| `cyber:privacy` | privacy-dpia → data-security → policy-review → advisory |

The other 34 skills are reachable directly but are not yet part of any pipeline.
That is not automatically a gap — some are reference or one-off skills that do not
belong in a fixed sequence. Candidates that probably *should* gain pipelines, in
rough order of likely demand: `cyber:appsec` (threat-model → appsec →
security-review), `cyber:detection` (detection-eng → siem → soar → edr), and
`cyber:awareness` (awareness-content → phish → metrics).

## Genuine gaps — nothing in the suite covers these

Named honestly rather than padded. Each is a function a security department
performs that no skill above addresses:

| Gap | Why it matters |
|---|---|
| Secure SDLC / DevSecOps | `appsec` reviews code; nothing designs the pipeline gates, SAST/DAST placement, or build-time policy |
| Identity governance (IGA) | `iam` and `iam-pam` handle access and privilege; nothing covers joiner/mover/leaver, access recertification, or entitlement review |
| Data classification & DLP | `data-security` is broad; no skill produces a classification scheme or DLP policy |
| Physical & environmental security | Absent entirely; ISO 27001 A.7 and NCA ECC both require it |
| Cyber insurance | Absent; increasingly a board question and it drives control requirements |
| Security budgeting & headcount | `vciso` advises strategy; nothing helps build a budget or justify spend |
| Board & regulator reporting | `metrics` produces numbers; nothing shapes a board narrative or a regulator submission |
| Security architecture review board | `security-architecture` designs; nothing runs the governance forum around it |
| Crisis communications | `breach-response` handles the technical incident; nothing covers notification drafting, regulator timing, or press |

The last one is worth flagging for KSA specifically: NCA and SAMA both impose
notification windows, and getting the comms wrong is a regulatory event
independent of the technical response.

## What this map is not

It does not judge the *quality* of any of the 61 skills — only that they exist and
what area they claim. Assessing whether `pentest` is any good requires running it,
which is what the runtime is for.
