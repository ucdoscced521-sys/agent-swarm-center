# Usage Guide · Agent Swarm Center

> **English** ｜ [简体中文](../05-使用说明.md)

**Version:** v0.2.0 ｜ **Audience:** people who use the plugin. No need to read the protocol source.
To change the protocol or the agent prompts, see the maintenance guide (Chinese only).

> **Translation baseline:** the Chinese source `docs/05-使用说明.md` at **v0.2.0** — both revisions ship in the same commit.
> If the two ever disagree, **the Chinese version is authoritative**; treat this file as needing a re-sync.

---

## Contents

1. [What it does / what it does not do](#1-what-it-does--what-it-does-not-do)
2. [Installation](#2-installation)
3. [How to invoke it](#3-how-to-invoke-it)
4. [What it does on its own](#4-what-it-does-on-its-own)
5. [What you will see on disk](#5-what-you-will-see-on-disk)
6. [The verdict contract](#6-the-verdict-contract)
7. [Independence and review tiers](#7-independence-and-review-tiers)
8. [Cost discipline](#8-cost-discipline)
9. [How to read the result](#9-how-to-read-the-result)
10. [Troubleshooting](#10-troubleshooting)
11. [Maintenance](#11-maintenance)
12. [Recipes](#12-recipes)
13. [Notes and known limits](#13-notes-and-known-limits)
14. [Version information](#14-version-information)

---

## 1. What it does / what it does not do

### ✅ What it does

- **One sentence in, a deliverable out** — it decomposes, staffs, executes, verifies and closes out without asking you mid-flight
- **Real parallelism** — several sub-agents run at once, each in its own working directory, never overwriting each other
- **Evidence-based verdicts** — a sub-agent may not report in prose. The only legal shape is JSON that passes a schema, with evidence paths that must exist on disk
- **Independent verification** — a second agent re-runs the acceptance criteria without reading the producer's conclusion
- **Failure escalation** — retry → restate → swap agent → ask you. Never an infinite retry loop
- **State on disk** — everything lives in `.swarm/`, so a new session can resume from disk alone

### ❌ What it does not do

| Limit | Why it matters |
|---|---|
| **It is not "ten extra pairs of hands"** | Every extra agent costs context. Cheap work should not be delegated to it |
| **It cannot verify a UI by itself** | There is no browser/DOM automation. Front-end correctness needs a human look, and the report will say so |
| **It cannot use a different vendor's model unless you provide one** | With a single model available, verification tops out at L2 (see §7) |
| **It cannot be trusted on "no evidence"** | If a report says a task is unverified, that means unverified. Do not read it as passed |
| **It does not accept work after close-out** | Close-out freezes the plan. Additional work needs a new, explicit task sheet |

---

## 2. Installation

The plugin ships as one self-contained directory, `agent-swarm/`, installable into **WorkBuddy** (expert center) and **Codex** (plugin marketplace). Installed copies live in **five locations**; the runtime cache is the one that actually gets loaded.

### Option A — use the sync script (recommended)

```powershell
# Defaults to <repo>/agent-swarm as the authoritative source.
# Override with AUTHORITATIVE_SRC if your layout differs.
node swarm-lab/tools/sync-expert.mjs
```

The script reads the version from `.codex-plugin/plugin.json`, syncs every location, and also updates stale version directories it finds.

### Option B — manual install

```powershell
$EXPERT_DIR = "$env:USERPROFILE\.workbuddy\plugins\marketplaces\my-experts\plugins"
Copy-Item "<repo>\agent-swarm" "$EXPERT_DIR\agent-swarm" -Recurse -Force

python <expert-manager>/scripts/validate_expert.py "$EXPERT_DIR\agent-swarm"
python <expert-manager>/scripts/register_expert.py "$EXPERT_DIR\agent-swarm"
python <expert-manager>/scripts/package_expert.py  "$EXPERT_DIR\agent-swarm"
```

### Post-install self-check

```powershell
# WorkBuddy: the runtime cache is what gets loaded — check it, not the source
(Get-Content "$env:USERPROFILE\.workbuddy\plugins\cache\my-experts\agent-swarm\0.2.0\.codebuddy-plugin\plugin.json" -Raw | ConvertFrom-Json).version

# Codex: version must match, installed/enabled both true
codex plugin list --json
```

> ⚠️ If the version looks stale, re-run the sync script. The single most common "I installed the new version but nothing changed" is an unsynced **runtime cache**.

---

## 3. How to invoke it

### WorkBuddy (GUI, day to day)

1. Left sidebar → **Experts**
2. → **My experts**
3. Find **Agent Swarm Center** → open → new conversation
4. Paste one sentence. The bundled starter prompt:

> Complete this task for me. Decompose it yourself, staff it yourself, verify it yourself, and don't ask me in between.

Two more starters:

> Use the most suitable expert from the hot list, and tell me why you picked it and who the backup was.
> Take over the previous stage: read `.swarm/HANDOFF.md` and `brief.json`, then continue.

### Codex

Must be invoked **explicitly** in a new session (it does not auto-activate):

```
$agent-swarm:agent-swarm
```

> To make it automatic, inject `agent-swarm/agents-fragment.md` into your `AGENTS.md`
> (put it at both the top and the bottom to resist long-context drift, and add a marker so you can revert). **Not injected by default.**

### Give it these three things to save a round trip

| Give it | Example |
|---|---|
| **Working directory** | "work inside `D:\proj\demo`" |
| **Deliverable shape** | "produces a runnable script" / "produces a markdown report" |
| **Hard acceptance requirement** | "must pass on Node 20" / "must not touch the DB schema" |

Without them it proceeds on stated assumptions and records them under "unverified items".

---

## 4. What it does on its own

```
Phase 0  Groundwork   writes .swarm/contract.md (working dir, budget, concurrency cap), creates the skeleton
Phase 1  Recon        scans locally available experts/skills/projects, produces a capability map (ranked)
Phase 2  Decompose    splits into independently verifiable tasks + dependency graph + acceptance criteria
Phase 3  Dispatch     ★ runs the 6-point pre-dispatch self-check, writes self-contained task sheets, spawns in parallel
Phase 4  Collect      reads only the head of each verdict file, judges via the json-gate (three gates)
Phase 5  Verify       risk-tiered review (R3 always / R2 sampled / R1 exempt)
Phase 6  Escalate     L1 retry → L2 restate → L3 swap agent → L4 ask you (no infinite retries)
Phase 7  Close out    freezes the plan, writes report.md (fixed 8 sections), writes HANDOFF + brief
```

### It stops and asks you only in three cases

1. It needs a decision and the information is insufficient (**it asks exactly one question**)
2. A budget or permission red line is about to be crossed
3. Everything is done and awaiting your acceptance

---

## 5. What you will see on disk

All state lives in `.swarm/` inside your working directory (**the single source of truth — never trust the chat transcript**):

```
<your project>/.swarm/
├── contract.md              environment contract: working dir / budget / concurrency / verdict contract
├── main-log.md              main log (append-only)
├── decisions.md             decision record (each entry: decision + reason + expected effect)
├── HANDOFF.md               handoff notes for the next session
├── state/
│   ├── tasks.json           task ledger (<5KB; read details on demand)
│   ├── brief.json           one-page status: what is done / in flight / blocked
│   └── events.jsonl         event stream: ts / event / task / actor  (real timestamps only)
├── bus/
│   ├── inbox/               task sheets sent to sub-agents
│   └── outbox/              verdicts coming back  (<task-id>.verdict.json)
├── evidence/<task-id>/      raw evidence: test output, logs, measured data
└── report.md                close-out report (produced at Phase 7)
```

**You will not find**: a running narrative of what it is thinking. That is deliberate — the transcript is disposable, the disk is not.

---

## 6. The verdict contract

A sub-agent **may not** report in prose. The only legal shape is `.swarm/bus/outbox/<task-id>.verdict.json`:

```json
{
  "verdict": "PASS",
  "task": "T-003",
  "agent": "builder-core@workbuddy",
  "evidence": ["evidence/T-003/test-run.txt", "evidence/T-003/summary.json"],
  "metrics": { "exit_code": 0, "tests": "12/12", "duration_s": 83 },
  "independent_level": "N/A",
  "handoff": "minimum information the next stage needs, <=300 chars"
}
```

**All seven fields are required.** One extra or one missing field is a structural violation.

### Three gates (all must pass)

| Gate | What it stops | Attribution code |
|---|---|---|
| **Structure** | spelling drift (`PASSED`/`pass`), undeclared extra fields, wrong types | `schema_violation` |
| **Identity** | a verdict about a different task | `task_mismatch` |
| **Fact** | a compliant verdict whose **evidence was fabricated** | `evidence_dangling` |

Others: `no_verdict` (nothing written) / `malformed_json` (not valid JSON).

### Two details

- `metrics.tests` holds a **short token only** (≤64 chars): ✅ `"88/88"`, ❌ `"all passing, but one edge case is uncovered"` (put prose in `handoff`)
- The verdict file's size is **bounded by the schema** (~2.9KB theoretical, 180–250B measured), so reading it whole costs almost no context

---

## 7. Independence and review tiers

### 7.1 Independence levels (who verifies)

| Level | Conditions (**all** must hold) | Effect |
|---|---|---|
| **L3** | verifier model from a **different vendor** than the producer | ✅ fully compliant (**prefer this**) |
| **L2** | ① different session ② different agent identity ③ **produces its own evidence** ④ **has not read the producer's verdict/conclusion** ⑤ isolated cwd | ⚠️ **conditionally compliant** — the level **must** be stated in `handoff` |
| **L1** | "different agent identity" only | ❌ **counts as not verified** — smoke re-reading at best |

- The verifier **must declare the true level** in `independent_level`
- **Overstating the level is fabrication**, far worse than downgrading
- At close-out the lead must tally each level and put the numbers in the report

### 7.2 Review tiers (how much to verify)

| Risk | Trigger | Review requirement |
|---|---|---|
| **R3 high** | real data / production DB, file deletion, public contract or public API change, DB schema change | **Independent review mandatory**, no exemption |
| **R2 medium** | new feature, core logic change, test changes | **Sample ≥50%**; the rest relies on reproducible evidence + gates |
| **R1 low** | docs, comments, copy, formatting, read-only audit | **Exempt**, but the report must state "R1 exempt" and why |

**Hard rules**

- R1 exempt → still counts toward acceptance (state the reason)
- **R2/R3 that should have been reviewed but was not → does not count toward acceptance, and close-out is forbidden**

---

## 8. Cost discipline

**Measured baseline:** one small project ran **1h46m / ≈200 credits** — too high. **The money is not spent on the work; it is spent moving the same information around repeatedly.**

### Eight rules (the agent applies these by default)

| # | Rule | Expected saving |
|---|---|---|
| **S1** | **Tiered review** (R3 always / R2 sampled / R1 exempt) | **30–40%** ← the only big lever |
| **S2** | **Summarize evidence**: output >8KB does not flow back; return `{exit_code, cases, failures, first failure}` + path | 10–20% |
| **S3** | **Run tests once, cite many times** (within a wave) | 10% |
| **S4** | **Read budget** (≤15 files / ≤12 commands per task) + **no repo-wide grep** | 10–15% |
| **S5** | **Tiered model routing** (fast model for recon/decompose/scribe/docs) | 5–15% |
| **S6** | **Merge dispatches** (changes to the same file become one task) | 5–10% |
| **S7** | **Close-out freeze** (no new dispatch after close-out) | 5% |
| **S8** | **Slim ledger** (`tasks.json` <5KB; read details on demand) | 5% |

**Expected total saving: 45–60%** (≈200 → 80–110 credits).

### 🔴 Red line

**You may cut repeated work and context; you may never cut evidence and verification.**
Relaxing verification to save money throws away every bit of validation work behind this tool.

### Suggested budget block for `contract.md`

```
BUDGET:
  per-task time <= 10 min | per-stage iterations <= 2
  per-task reads <= 15 files | per-task commands <= 12
  global token cap <= 300k (pause and report when exceeded)
CONCURRENCY: 3 (cap 5)
VERIFY: R3 always | R2 sample 50% | R1 exempt (with a note); target L3, use L2 with a label if unavailable
```

---

## 9. How to read the result

Every close-out produces `report.md` (its path is written into `HANDOFF.md`), with a **fixed 8 sections**:

| # | Section | What you see |
|---|---|---|
| 1 | Scope | what was done / **what was explicitly not done** |
| 2 | Deliverables | absolute path list |
| 3 | Acceptance | per criterion: original text → verdict → evidence path |
| 4 | **Review coverage and independence levels** | numeric, e.g. `L3×2 / L2×8 / L1×0 / R1 exempt×2`, plus coverage x/y |
| 5 | **Unverified items (honest boundaries)** | each one falsifiable, with "how to verify" |
| 6 | Risks and leftovers | including "red-line-adjacent actions" |
| 7 | **Cost** | dispatches / reviews / estimated tokens / **versus budget** |
| 8 | Next actions | the first executable actions for a new session |

### Three health numbers — spot slacking at a glance

1. **reviews ÷ dispatches** — near 1:1 means **S1 is not working** (you are paying twice); far below 0.5 means reviews are being skipped
2. **Is section 4 numeric?** — "independently verified" with no level counts is a fail
3. **Is section 5 non-empty?** — zero unverified items usually means problems are being hidden, not that the work was flawless

---

## 10. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `Team type must have settings.json` | WorkBuddy asynchronously removes `settings.json` from the marketplace source | Re-run the sync script (it re-creates the file at the end) |
| Invoking it still yields the old behaviour | **the runtime cache was not synced** (by far the most common) | Run the sync script; compare cache against source byte-for-byte |
| Codex still shows the old version after install | marketplace manifest not updated / not removed first | check `.codex-plugin/plugin.json`; `plugin remove` then `add` |
| All verdicts come back `no_verdict` | **two dispatch roots**: task sheets used relative paths and producers created their own `.swarm/` | task sheets must use **absolute paths** for `SWARM_DIR` |
| Verdict rejected with `schema_violation` | field typo / extra field / too long | resend using the 7-field template in §6; keep `tests` short |
| Concurrency metrics cannot be computed | wrong field names in `events.jsonl`, or synthesized timestamps | use `ts/event/task/actor`; `ts` must be a real instant |
| Verdicts keep being resent | acceptance criteria contradict the "do not touch" scope | that is a **dispatcher** bug (see the 6-point self-check in §11) |
| It seems stuck for a long time | normal for long tasks, not a failure | read `.swarm/state/brief.json`; or ask it where it is blocked |

**General triage, in order:** ① `.swarm/state/brief.json` (one page of state) ② the tail of `.swarm/main-log.md` ③ the latest entries in `decisions.md`.

---

## 11. Maintenance

### 11.1 The self-check you must run after editing prompts

**6-point pre-dispatch self-check** (enforced by the protocol; also applies when you edit the prompts):

```
[ ] every path absolute?  (never a relative SWARM_DIR)
[ ] do acceptance criteria conflict with the "do not touch" scope?
[ ] does the task sheet contradict itself?
[ ] is the referenced contract the single source?  (no second "roughly the same" schema)
[ ] are criteria hard-coded to values that will expire?  (prefer "exit 0 and 0 failures")
[ ] if the criteria can only be met by violating a constraint, what should the producer do?
     -> must be stated: report it, never force a PASS
```

> **Measured lesson:** in one real run, contract-layer mistakes happened **5 times** and the lead caught **0** of them itself — every one was found downstream first. Error rate ≈ **19%**.

### 11.2 Full version upgrade flow

```powershell
# 1) bump the version in BOTH places
#    agent-swarm/.codebuddy-plugin/plugin.json
#    agent-swarm/.codex-plugin/plugin.json

# 2) sync to all five locations (the script reads the version and finds stale dirs)
node swarm-lab/tools/sync-expert.mjs

# 3) validate -> register -> package
python <expert-manager>/scripts/validate_expert.py "<location 1>"
python <expert-manager>/scripts/register_expert.py "<location 1>"
python <expert-manager>/scripts/package_expert.py  "<location 1>"

# 4) sync once more (re-creates settings.json)
node swarm-lab/tools/sync-expert.mjs

# 5) wiring check (9 assertions)
node swarm-lab/tools/run-step6-wiring.mjs

# 6) switch the Codex side
codex plugin remove agent-swarm@personal
codex plugin add    agent-swarm@personal --json
```

### 11.3 Regression suite you must run after editing the protocol

```powershell
node swarm-lab/tools/run-step1.mjs   # minimal loop      16/16
node swarm-lab/tools/run-step2.mjs   # real parallelism  18/18
node swarm-lab/tools/run-step3.mjs   # verdict hardening  8/8
node swarm-lab/tools/run-step4.mjs   # boundary hardening 26/26
```

**If you changed `schemas/verdict.schema.json`, also make one real provider call** (strict-mode constraints only surface with a real model):

```powershell
node swarm-lab/tools/run-step5a.mjs 1
```

### 11.4 Routine audit after a real run

```powershell
node swarm-lab/tools/audit-real-run.mjs "<your working directory>"
```

**Do not trust its HANDOFF** — re-judge every outbox verdict with the authoritative schema and gate, and check the protocol artefacts (legacy protocol leftovers / schema drift / duplicate dispatch roots / event stream / review coverage).

### 11.5 Uploading to GitHub (including the no-TTY trap)

```powershell
# first upload: self-driven device-code auth -> create the private repo -> push branch + tags
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gh-device-auth.ps1 `
    -RepoName agent-swarm-center -CreateRepo

# later, incremental pushes
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/push-to-github.ps1 -RepoName agent-swarm-center
```

The script prints an **authorization URL and a one-time code**; you enter it in the browser and approve. Everything else is automatic.

> ⚠️ **Two traps you will hit**
> 1. **`gh auth login --web` always fails without a TTY** (`unexpected EOF` / `context deadline exceeded`). The code lands in the clipboard after the process is already gone. Use `gh-device-auth.ps1`, which drives the device flow itself.
> 2. **`github.com` may be unreachable while `api.github.com` works.** Both the token exchange and `git push` go to the main site, so **gh *and* git both need the proxy** (default `http://127.0.0.1:7897`, change with `-Proxy`). Verify with:
>    `curl --proxy <proxy> -s -o NUL -w "%{http_code}" https://github.com/` → expect `200`.
>
> **Security:** the script writes the token to a temp file and deletes it right after login; the push uses a **one-shot auth header** (`git -c http.extraheader=...`), so **no credential is written into `.git/config`**; the token is never printed.

---

## 12. Recipes

Six scenarios. Replace the bracketed parts with your own values. Each one states **what success looks like**.

### Recipe 1 · First run: the smallest task (start here)

> **Purpose:** check that it really decomposes, dispatches and verifies instead of doing everything itself. Conclusion within half an hour.

```
Complete this task for me. Decompose it yourself, staff it yourself, verify it yourself,
and don't ask me in between.

Task: in [D:\proj\demo] write count-fields.mjs:
      it takes a path to a JSON file and prints the number of top-level fields.
Working directory: [D:\proj\demo]
Acceptance: node count-fields.mjs sample.json  -> prints 3 and exits 0
            passing an array or a missing path  -> exits non-zero
```

**Success looks like:** section 4 of `report.md` contains numbers (it really reviewed), and section 5 is non-empty (it dares to say what it did not verify).

---

### Recipe 2 · Real parallelism: three independent tasks

> **Purpose:** check that "parallel" means parallel, not queued.

```
Do three things inside [D:\proj\site]. They are independent, so run them in parallel:
1. write pages/index.html - static, a title plus one paragraph
2. write api/health.mjs  - Node 20, GET returns {"ok":true}
3. write one smoke test for each of the above
Acceptance: each sub-task is independently verifiable, and evidence lands in .swarm/evidence/<task-id>/
```

**Success looks like:** you can compute a **concurrency > 1** from `.swarm/state/events.jsonl` (overlapping `task.start` windows).

---

### Recipe 3 · Save credits: budget + tiered review (the biggest lever)

> **Purpose:** cut "1:1 review of everything", the single largest cost. **A docs-only task should end with zero reviews.**

```
Budget: at most 6 dispatches and 2 reviews; stop and ask me if you exceed that.
Review by risk tier: R3 always / R2 sample half / R1 exempt but must leave a note.
Task: update stale version references under [docs/] to v0.2.0.
```

**Success looks like:** section 4 shows `R1 exempt×N` and **reviews far below dispatches**. Still 1:1 means the discipline is not active.

---

### Recipe 4 · Read-only audit: touch nothing

> **Purpose:** audit an existing run while **explicitly forbidding writes** (so it does not "helpfully" edit something).

```
Read-only mode: do not modify, create or delete any file.
Task: audit the .swarm artefacts of [C:\path\to\project] -
      re-run the verdicts with swarm-lab/tools/audit-real-run.mjs and produce a markdown report:
      verdict compliance rate / review coverage / independence-level distribution / unverified items.
Acceptance: every number in the report maps to a file on disk, with its path.
```

**Success looks like:** `git status` is clean afterwards, except for the report it produced.

---

### Recipe 5 · Resume in a new session (without redoing finished work)

> **Purpose:** hand a long task across sessions. **It reads state from disk, not from chat memory.**

```
Take over the previous stage: first read [.swarm/HANDOFF.md] and [.swarm/state/brief.json],
then continue. Do not redo what is already finished.
```

**Success looks like:** its first action is reading files, not asking you "where were we?".

---

### Recipe 6 · When the result is not good enough

> **Purpose:** turn "this feels unreliable" into an executable instruction. **Never just say "check again".**

```
Your report.md does not pass. Re-run close-out. Do not change conclusions, only add evidence:
- section 4 has no numbers -> give review coverage x/y and the L1/L2/L3 split
- section 5 is empty     -> give at least 2 falsifiable unverified items (each with "how to verify")
- section 7 has no cost  -> add dispatches / reviews / comparison against budget
If the evidence cannot be produced, turn the corresponding acceptance criterion into FAIL and explain why.
```

**Success looks like:** the new report has concrete numbers or explicit FAILs — not phrases like "fully verified".

---

## 13. Notes and known limits

### 13.1 Five things to know before you use it

| # | Note | Why |
|---|---|---|
| 1 | **It buys you one more review, not ten more hands** | Every extra agent adds context cost; do not delegate cheap work |
| 2 | **Do not edit the same files while it is working** | It has its own working directory; your edits cause merge conflicts |
| 3 | **A verdict has exactly one legal shape** (JSON passing the schema) | Asking "is it done?" in chat is not a verdict |
| 4 | **What it says is unverified really is unverified** | See the limits below; do not read "unverified" as "passed" |
| 5 | **Do not dispatch more work after close-out** | Close-out freezes the plan; send a new task sheet instead |

### 13.2 Known limits

| # | Unverified / not possible | Impact |
|---|---|---|
| 1 | **Long-running real-world use** | full end-to-end only on one personal workbench project (26 dispatches / 11 waves) |
| 2 | **Cross-host CLI channel** (Codex → WorkBuddy) | in restricted environments `-p` does not execute one-shot turns; falls back to a file bus |
| 3 | **L3 independence** | with a single model available only L2 is reachable; the protocol tiers this and requires a label |
| 4 | **Front-end visual verification** | no browser/DOM automation; UI correctness needs a human pass, and the report says so |
| 5 | Isolation uses **separate directories**, not `git worktree` | functionally equivalent; use worktrees in production (both host CLIs support `-w`) |

> All five appear in the "honest boundaries" section of `HANDOFF.md`. **When it says something is unverified, it means it.**

---

## 14. Version information

### 14.1 Current version

| Item | Value |
|---|---|
| **Package version** | **v0.2.0** |
| Version declared in | `agent-swarm/.codebuddy-plugin/plugin.json`, `agent-swarm/.codex-plugin/plugin.json` (**both must match**) |
| Git tag | `v0.2.0` |
| Files in package | **33** |
| Agents | **8** |
| Protocol doc | `skills/agent-swarm/references/protocol.md` (28,271 bytes, single source of truth) |
| Verdict contract | 7 required fields: `verdict` / `task` / `agent` / `evidence` / `metrics` / `independent_level` / `handoff` |
| Hosts | WorkBuddy (expert center), Codex (plugin marketplace) |

> `version: "1"` in `manifest.yaml` is the **manifest schema version**, unrelated to the package version. **Do not change it.**

### 14.2 Version history

| Version | Date | Highlights |
|---|---|---|
| **v0.2.0** | 2026-09-25 | **Protocol hardening**: JSON + schema-enforced verdicts (three gates); capability contract for the lead (default-deny + allowlist, out-of-bounds actions physically impossible); independence tiers L1/L2/L3; review tiers R1/R2/R3; 6-point pre-dispatch self-check; enforced event schema (`ts/event/task/actor`, no synthesized timestamps); absolute paths in task sheets; eight cost rules; fixed 8-section `report.md` |
| v0.1.0 | 2026-09-25 | First usable release: 8 agents, dual-host deployment, file bus, text protocol `### 判定:` |

Full change history: **[`CHANGELOG.md`](../../CHANGELOG.md)**.

### 14.3 Compatibility constraints

| Constraint | Detail |
|---|---|
| **Schema strict mode** | every object's `properties` must be listed in full under `required` (provider constraint — no "optional fields") |
| **Changing the schema requires a real provider call** | your own validator passing does not mean the provider accepts it. After any change run `node swarm-lab/tools/run-step5a.mjs 1` |
| **Both hosts must be on the same version** | mismatched `plugin.json` files make Codex install the old version |
| **Codex needs remove-then-add** | a plain `add` does not overwrite: `plugin remove agent-swarm@personal` first |
| **No credentials in the package** | no tokens, keys or account data — safe to host publicly or privately |

### 14.4 Upgrading / confirming which version is running

- **Upgrade flow:** see [§11.2](#112-full-version-upgrade-flow) (bump version → sync five locations → validate/register/package → re-sync → wiring check → switch Codex)
- **Confirm the running version:**

```powershell
# WorkBuddy: the runtime cache is what actually gets loaded
(Get-Content "$env:USERPROFILE\.workbuddy\plugins\cache\my-experts\agent-swarm\0.2.0\.codebuddy-plugin\plugin.json" -Raw | ConvertFrom-Json).version

# Codex
codex plugin list --json     # check version / installed / enabled
```

> ⚠️ **The most common "new version installed but not in effect":** the marketplace source was updated but the **runtime cache** was not. Running `node swarm-lab/tools/sync-expert.mjs` once syncs every location.
