---
name: predictive-team-exec-analytics
description: Generate Team Executive reports with predictive analytics, Monte Carlo simulation, completion probability, QI forecasting, and confidence intervals. Use when the user asks for forecasts, "will the release land", trend analysis, what-if scenarios, or any team-exec-level question that goes beyond current state to "what will happen".
audience: team-exec, portfolio_mgr
---

# Predictive Team Executive Analytics (project-level reference)

This skill is canonically defined at:

```
~/.cursor/skills/predictive-team-exec-analytics/SKILL.md
```

The canonical package includes a substantial implementation:
`PredictiveTeamExecAnalytics.js`, `models/CompletionPredictionModel.js`,
`models/QualityForecastingModel.js`, `analytics/HistoricalAnalyzer.js`,
`integrations/NutanixJiraIntegration.js`,
`integrations/ExistingSystemIntegration.js`,
`visualizations/PredictiveCharts.js`. Read those before the port.

## When to Use This Skill

- Team Executive asks "will we land on the planned GA?" or "what's the risk we
  slip?"
- Generating any forecast / probability / confidence interval
- What-if scenario analysis (add headcount, drop scope, extend
  timeline)
- Monte Carlo release-outcome distribution (P10/P50/P90)
- QI forecasting from current trend

## Why It Matters Here

This is **capability #8** in `CONSOLIDATION.md` and replaces my
phantom `predictabilityService.ts` stub. The port lives at
`shared/services/predictiveAnalyticsService.ts` once it lands.

It composes with **capability #4** (landing forecast — the
deterministic version) and depends on **capability #1** (the canonical
release dataset) for its input.

## Core Rules (memorise — protects model integrity)

1. Never present a prediction without a confidence interval
2. At least 2 historical releases required to train velocity model;
   warn if fewer
3. Risk probability comes from the statistical model, never from a
   manual guess
4. Executive summary states the model's prediction accuracy alongside
   the forecast
5. Strictly separate "current status" (factual) from "forecast"
   (probabilistic) in every report
6. Monte Carlo scenarios require minimum 1,000 simulations before
   reporting percentile outcomes

## Output Shape

Every predictive Team Executive report produces:

1. **Predictive Executive Summary** — completion probability,
   confidence interval, top 3 risks
2. **Project Forecasts** — per-project predicted completion +
   probability
3. **Risk Scenarios** — Monte Carlo P10/P50/P90 outcomes
4. **Velocity Dashboard** — team velocity trend (last N sprints)
5. **Action Items** — AI-generated, ranked by predicted business
   impact

Delivered as `.md` (archival) + `.html` (email-compatible, ≤ 800px,
inline CSS).

## Quality Validation

- [ ] Every prediction has a confidence interval
- [ ] Historical baseline ≥ 2 releases (or warning issued)
- [ ] Risk numbers cite the model (not "I think")
- [ ] Forecast section visibly separated from current-state section
- [ ] Monte Carlo runs ≥ 1,000 simulations
