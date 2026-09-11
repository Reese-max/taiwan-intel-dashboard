# Issue #19 — Code / Data / Generated-Content Licensing Boundaries

Research deliverable for `Reese-max/taiwan-intel-dashboard#19` (P3, RESEARCH_REQUIRED).
This document is the evidence-backed decision record the issue asks for. It does **not**
itself create a `LICENSE` file — the final license choice is the owner's act; this doc
frames the decision so the owner can sign off by accepting one option per layer.

## 1. Current state (verified 2026-09-11)

| Layer | Fact | Evidence |
|---|---|---|
| Repo metadata | `license: null`, public | GitHub API `license` field |
| Repo tree | no `LICENSE`/`COPYING` | default-branch tree scan |
| Per-source notices | `license` strings on government adapters (政府資料開放授權條款-第1版, 政府網站資料開放宣告) | `scripts/fetch-live.mjs:858–960`, `scripts/lib/fetch-official.mjs:56–144` |
| UI display | `SourcePanel` renders `source.license` | `src/components/SourcePanel.ts:21,141–149` |
| README | provenance documented; no rights contract | README.md |

The per-source `license` field records the **upstream** license of each feed. It does not
declare rights for the project's own code, the transformed datasets, generated artifacts,
news-derived text, or contributions.

## 2. The five layers that need separate decisions

Licensing is not one file — the pipeline mixes five material classes with different
owners:

### 2.1 Original source code
Authored here. Owner can pick any license. Recommended: **MIT** — permissive, standard
for dashboards/tooling, does not conflict with upstream open-data terms. Alternative:
Apache-2.0 if patent grant matters; 0BSD equivalent. Copyleft (GPL/AGPL) would leak into
every deployment and is mismatched for a public-info dashboard.

### 2.2 Copied/transformed public datasets (政府開放資料)
Governed by upstream terms, not our choice:
- 政府資料開放授權條款-第1版 (Open Government Data License v1) — permits free use incl.
  modification/redistribution; requires attribution naming the source agency; **cannot
  be relicensed** — downstream copies must retain the notice.
- 政府網站資料開放宣告 — similar attribution requirements per agency.
- Obligation that flows to us: keep the per-source `license` field accurate and rendered
  (already done via SourcePanel); add a `NOTICE`/attribution file aggregating them.

### 2.3 News / RSS titles, excerpts, LLM-generated summaries
- Raw headlines/facts: not copyrightable as facts in most jurisdictions, but headlines
  and excerpts are thin-ice territory — keep excerpts short (already bounded), attribute
  source+link, never republish full articles.
- **LLM summaries**: derivative of upstream text. Safe posture = transformative, short,
  attributed, and the summary's own license follows the code/artifact policy (§2.4).
  Do not claim copyright over facts; disclaim any grant over quoted source text.

### 2.4 Generated artifacts (static site, JSON snapshots, maps)
Built output mixing §2.2 + §2.3. Recommended: **CC BY 4.0** for project-generated
content (summaries, aggregations, visual arrangement), with a carve-out clause:
"underlying government data remains under its original open-data license; quoted news
text remains property of its publisher." This is the standard split (code MIT / content
CC BY) used by data-journalism projects.

### 2.5 External contributions
Without a CLA or DCO, contributions are licensed inbound under the repo license
(GitHub ToS §D.6 "inbound=outbound" default). Recommended: state this explicitly in
`CONTRIBUTING.md` — no separate CLA needed at this scale.

## 3. Recommended package (decision-ready)

| Artifact | Content | Effort |
|---|---|---|
| `LICENSE` | MIT — covers original code | trivial |
| `NOTICE` or `LICENSE-CONTENT` | CC BY 4.0 for generated content + aggregated upstream attribution table (auto-generated from the adapter `license` fields) | small script over existing data |
| README §License | one paragraph linking both + the §2.3 posture (excerpts short, attributed; no full-text republishing) | trivial |
| `CONTRIBUTING.md` | inbound=outbound (MIT) statement | trivial |

## 4. What this does NOT decide

- Whether government feeds permit our specific transformation — each adapter already
  records its source license; audit-worthy per-source, not blocked by this issue.
- Trademark/name rights ("Taiwan Intel Dashboard" name not covered by MIT/CC).
- This is not legal advice; an attorney should review if the project commercializes.

## 5. Acceptance path for the owner

1. Approve §3's package (or amend per layer).
2. Follow-up PR lands `LICENSE`, `LICENSE-CONTENT`, README section, CONTRIBUTING note.
3. `scripts/` gains a NOTICE generator pulling adapter `license` strings (optional,
   keeps attribution table honest).
