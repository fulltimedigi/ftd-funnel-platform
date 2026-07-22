# Config Guide

> Foundation placeholder (SPEC §6). Full guide written during build, aimed at a
> non-engineer authoring a funnel from a config file.

A new client = a **new `config.json` + a theme choice**. No engine code changes.

## What you edit
See `configs/_schema.json` for the full contract. Top-level sections:

- `brand` — name, logo, tagline
- `theme` — pick a file from `themes/` (e.g. `luxury-gold-light`)
- `hero` — eyebrow, headline, subtext, chips, start button label
- `scoring` — mode (`sum-band` | `dominant` | `weighted-multi`) + flags
- `questions` — the question + option list (**every question must affect scoring**)
- `archetypes` — 4–7 personas, each with recommendations (**each rec needs a `becauseTemplate`**)
- `resultLayout` — `personas` | `commerce` | `tracks`
- `leadForm` — fields, gated?, skippable?
- `cta` — primary label + URL (+ UTM)
- `analytics` — sinks + Sheets endpoint

## Rules you cannot break (the FullTimeDigi standard)
1. Every question must change the result for some answer (no theater).
2. Every recommendation must carry a `because`.
3. Lead capture must point at a real `sheetsEndpoint`.
4. Discounts/urgency must be honest.

## TODO (during build)
- Worked example walking through one archetype end to end.
- Field-by-field reference with copy-writing tips.
