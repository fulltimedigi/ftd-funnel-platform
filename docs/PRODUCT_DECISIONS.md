# Product Decisions (agreed with the operator)

> A living record of product-shape decisions agreed with the operator. **Binding
> direction** for Stage 2 (authoring) and Stage 3 (delivery). Do not silently deviate;
> if a decision needs to change, raise it with the operator and update this file.
> Referenced from `CLAUDE.md`.

---

## 1. Inputs — URL-first, "draft → refine"

- **URL-only is the magic default.** Pasting the brand/store URL is enough. **No required
  form** in front of the operator — that friction kills the wedge.
- **The AI auto-derives everything it can:** decision axes, questions, archetypes,
  answer→product mapping, and branding (logo/colors) from the site.
- **Model = draft, then refine.** The AI produces a full funnel in seconds; the operator
  *optionally* tweaks it via a small **refine panel** — editing the AI's draft, never
  filling a blank form.
- **The one input worth asking up front (optional): the business goal** — what should this
  funnel achieve? (sell a high-margin line / capture leads for sales / push a new
  collection / book consultations). The AI cannot infer this from the catalog, and it is
  what turns a "nice quiz" into a revenue tool. It steers the next-action and which
  products get emphasized.
- **Optional refine knobs** (all default to auto): hero/priority products or collection ·
  funnel length (3 short vs 5–7 deep) · result style (decisive top-1 vs a short ranked
  list) · lead-capture fields + destination · offer / social-proof / occasion framing.
- **Stock awareness:** never recommend an out-of-stock item when the catalog exposes stock.
- **REJECTED — "all products shown with equal exposure %."** That is a catalog spinner,
  not a decision funnel, and it violates the Anti-Bland standard (the value is a
  *justified* pick, not fair rotation). Instead: **one justified pick per user**, and
  enough branching that **most of the catalog is reachable across different users**
  (fair coverage across visitors, never equal odds for one visitor).

## 2. Output formats — one config, three packagings

The `config` **is** the funnel; the engine renders it. From the same config we ship:

| Format | Use | Note |
|--------|-----|------|
| **Hosted page (URL)** | standalone landing / lead magnet | centrally updatable + tracked |
| **Embed snippet (iframe / one line)** | drop **into the top of the client's own site** | the hero format for "a strong lead at the top of the page" |
| **Single self-contained HTML file** | hand-off / self-host / portability | engine + config + CSS inlined; runs anywhere |

Prefer **Embed** as the primary "top of site" format (updatable + tracked); the single
file is for hand-off/portability.

## 3. Lead destination — configurable "sink", rich payload

The funnel does **not** bundle a data file; it **sends** each lead to a configurable
destination (we already have a pluggable sink pattern):

- **Default (zero cost): Google Sheets via Apps Script** — `integrations/google-apps-script/Code.gs`,
  deployed **once per client**, its `/exec` URL placed in the config; opens as Excel.
  ⚠️ **Friction to solve:** deploying the Apps Script is a manual step — make it turnkey /
  guided for non-technical clients. (Webhook, below, avoids this.)
- **Universal: a Webhook sink** — one sink unlocks **GHL, Zapier, Make, and most CRMs at
  once.** This is the 80/20 integration backbone.
- **Our edge = the payload.** We send more than an email: **email + the user's answers +
  the recommended real product + archetype + score** — enabling personalized downstream
  nurture.

## 4. Integration strategy — integrate, don't compete

- Against all-in-one platforms (**GoHighLevel / GHL**, etc.): **we are the smart diagnostic
  front-end that FEEDS them.** Never try to become a CRM — our wedge is the AI funnel.
- **GHL specifically:** push the lead to their inbound webhook → triggers their workflows;
  and our funnel **embeds as an iframe inside a GHL page.** Route/segment by the
  **recommended product / archetype** (different pipeline for "luxury oud" vs "gift").
- Stay **CRM-agnostic** — the webhook covers ~90%. Build **native connectors later** only
  if a specific platform becomes a large channel.

---

## Roadmap placement

- Inputs + "draft→refine" + the anti-bland authoring → **Stage 2**.
- Output formats (embed/hosted/single-file) + **webhook sink** + integrations (GHL) →
  **Stage 3 (delivery)**.
