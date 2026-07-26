# Third-Party Skills — Notices & Provenance

These skills were vendored into `ftd-os/.claude/skills/` from external open-source
repositories on 2026-07-26. They are markdown instruction sets only (no executable
scripts were copied). Each is used under its original license.

| Package | Source repo | Commit (SHA) | License | Skills added |
|---|---|---|---|---|
| Marketing Skills | github.com/coreyhaines31/marketingskills | `c21a984` | MIT | 47 marketing skills (copywriting, cro, seo-audit, ai-seo, cold-email, emails, ads, ad-creative, pricing, positioning/product-marketing, competitor-profiling, customer-research, landing/site-architecture, signup, popups, paywalls, lead-magnets, analytics, launch, etc.) |
| Humanizer | github.com/blader/humanizer | `523374d` | MIT | `humanizer` — strips AI-writing tells from copy; enforces a no-fabrication rewrite rule |
| Taste Skill | github.com/Leonxlnx/taste-skill | `e988add` | MIT | `taste-skill` (anti-slop landing/redesign frontend) + `brandkit` (brand styling) |
| Find Skills | github.com/vercel-labs/skills | `e173b8c` | MIT (Vercel) | `find-skills` — meta-skill to discover/install other skills via the `npx skills` CLI (skills.sh) |

## Notes for our use
- **Under our own standards.** Design skills (`taste-skill`, `brandkit`) operate **below**
  `ftd-funnel-platform/docs/UX_INTERFACE_DECISION.md` and our funnel design standards —
  those bindings win on any conflict.
- **`humanizer` is English-tuned.** Its 33 AI-writing tells target English text; verify
  coverage before relying on it for Arabic copy. Its no-fabrication rule aligns with our
  trust laws.
- **Start here:** `product-marketing` is the foundation skill the others reference — run it
  first for a brand so the rest share consistent product/audience/positioning context.
- `evals/` test directories from the upstream packages were intentionally excluded.
- License texts: `_LICENSE-marketingskills`, `_LICENSE-taste-skill`, and `humanizer/LICENSE`.
