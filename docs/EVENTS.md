# Analytics Events Reference

> The fixed event vocabulary (SPEC §11). Emitted from day one. Without this we
> can't prove ROI — and ROI is what we sell.

| Event | When | Payload |
|---|---|---|
| `quiz_start` | first question shown | funnelId, theme, timestamp |
| `question_answered` | each answer chosen | funnelId, questionId, optionId, stepIndex |
| `question_back` | user navigates back | funnelId, fromStep, toStep |
| `lead_shown` | lead form displayed | funnelId |
| `lead_submitted` | lead submit attempted | funnelId, success (bool after resolve) |
| `lead_skipped` | user skips lead form | funnelId |
| `result_shown` | result rendered | funnelId, primaryArchetype, secondaryArchetype, flags |
| `cta_clicked` | primary/secondary CTA clicked | funnelId, ctaTarget, archetype |
| `funnel_complete` | result fully reached | funnelId, archetype, leadCaptured (bool) |
| `restart` | user restarts | funnelId |

## Sinks
- `analytics/sheets-sink.js` — Apps Script Events tab (default, zero-cost).
- `analytics/ga4-sink.js` — GA4 via gtag (optional, if `ga4Id` set).

## Metrics we must be able to read after launch
Per-step drop-off · completion rate · lead-capture rate · archetype distribution ·
CTA click-through · lead→conversion (client-reported).
