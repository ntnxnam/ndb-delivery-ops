# Project Lighthouse — Ritual hours → $ (data SoT)

Planning model. Not Comp Band exacts. Not build-cost payback.  
**Formula:** `$/yr = hrs/wk × people × 52 × (CTC ÷ 2,080)`

## CTC assumptions (avg for people doing this job)

| Band | CTC (USD) | $/hr (= CTC ÷ 2080) |
|------|-----------|---------------------|
| US | $300,000 | $144.23 |
| India | $150,000 | $72.12 |
| Mexico | $75,000 | $36.06 |
| **Median (pitch default)** | **$150,000** | **$72.12** |

Use **Median** for mixed NDB Ops footprint unless Finance substitutes geo mix.

---

## Ritual hours by role (before → after Lighthouse)

### TPM / RM — 10.0 hrs/wk × 1 person
| Hrs | Ritual | Why |
|-----|--------|-----|
| 3.5 | Assemble SoS / Brief | 5–8 JIRA filters, RAG reconcile, slide/Confluence rebuild, re-check counts |
| 2.0 | Status / weekly email | Rewrite for email voice, distribution, reply-all clarifications |
| 2.5 | Chase EMs | 15–20 min × 8–10 people + follow-ups for green/red / blockers |
| 1.5 | OnCalls / CFD / CFI pull | Separate JQLs → mini weekly report (now KPI chips) |
| 0.5 | Staff stitch | Last-mile paste into staff pack |
| **10.0** | **Total** | ×52 = **520 hrs/yr** |

**Status:** Accruing (live surfaces)

### EM — 5.0 hrs/wk × 8 people on the pulse
| Hrs | Ritual | Why |
|-----|--------|-----|
| 2.0 | Queue archaeology | Dig open / TBV / stale items before standup or staff ask |
| 2.0 | KPI hunt | Find OnCalls / CFD / CFI / P0-P1 for “my” slice without a chip |
| 1.0 | Status prep | Green/red + blockers for TPM chase / Risk Indicator hygiene |
| **5.0** | **Total per EM** | ×8 ×52 = **2,080 hrs/yr org** |

**Status:** Accruing (reminders + KPI pulse + one URL)

### Director / VP — 3.0 hrs/wk × 1 person (staff owner)
| Hrs | Ritual | Why |
|-----|--------|-----|
| 1.5 | Staff readout stitch | Assemble green/red from decks, mail, side channels |
| 1.0 | Clarify contested numbers | Follow-ups when sources disagree |
| 0.5 | Ad-hoc “what’s the OnCall / CFD picture?” | Mini pulls outside the standing pulse |
| **3.0** | **Total** | ×52 = **156 hrs/yr** |

**Status:** Accruing (one URL in staff)

### Capacity owners (RM / EM mix) — ~4.0 hrs/wk avg × 1 FTE-equivalent
| Hrs | Ritual | Why |
|-----|--------|-----|
| ~4.0 avg | H2 workbook rebuild / re-reconcile | Seasonal spike annualized; still partly Excel |
| **~4.0** | **Total** | ×52 = **~210 hrs/yr** |

**Status:** Still ahead (Capacity UI beam)

---

## Hours rollup

| Role | People | Hrs/wk each | Hrs/wk org | Hrs/yr | Status |
|------|--------|-------------|------------|--------|--------|
| TPM / RM | 1 | 10.0 | 10.0 | 520 | Accruing |
| EM | 8 | 5.0 | 40.0 | 2,080 | Accruing |
| Director / VP | 1 | 3.0 | 3.0 | 156 | Accruing |
| Capacity | 1 | ~4.0 | ~4.0 | ~210 | Still ahead |
| **Accruing subtotal** | | | **53.0** | **2,756** | |
| **With capacity** | | | **~57.0** | **~2,966** | |

---

## $ rollup at Median CTC ($150k → $72.12/hr)

| Role | Hrs/yr | $/yr (median) |
|------|--------|---------------|
| TPM / RM | 520 | **$37,500** |
| EM ×8 | 2,080 | **$150,000** |
| Director / VP | 156 | **$11,250** |
| **Accruing now** | **2,756** | **~$199k** |
| Capacity (still ahead) | 210 | **~$15k** |
| **If capacity lands** | **~2,966** | **~$214k** |

### Sensitivity — TPM-only hrs at geo CTC (illustrative)

| Geo CTC | $/hr | TPM 520 hrs → $/yr |
|---------|------|--------------------|
| US $300k | $144 | ~$75k |
| India $150k | $72 | ~$37k |
| Mexico $75k | $36 | ~$19k |

### Sensitivity — full accruing org (2,756 hrs) at geo CTC

| Geo CTC | Org $/yr accruing |
|---------|-------------------|
| US $300k | ~$397k |
| Median / India $150k | ~$199k |
| Mexico $75k | ~$99k |

---

## What this is / isn’t

- **Is:** Run-rate value of rituals removed, hours bottom-up, $ via assumed avg CTC.
- **Isn’t:** Comp Band exacts, Finance-approved budget, or Lighthouse build-cost payback.
- **Validate:** TPM/EM diary week before external use; swap CTC with Finance geo mix when leaving Eng Ops.
