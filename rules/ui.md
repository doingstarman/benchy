# UI Rules

## Design Aesthetic

Langfuse / LangSmith — dense, dark, developer-tool. Not a marketing site.  
Data-first: the content is the design. No decorative elements or illustrations. The one sanctioned decorative device: gradient hairline dividers (`var(--hairline)`) that fade at the edges — use them for section/turn separators instead of plain border lines.

## Primitives — use these, don't re-style

Shared components in `frontend/src/components/`:

| Component | File | Replaces |
|---|---|---|
| `Button` (primary/ghost/danger, `small`) | `ui.tsx` | all inline-styled buttons |
| `IconButton` (with `active` state) | `ui.tsx` | card-header glyph buttons |
| `Input` | `ui.tsx` | ad-hoc styled text inputs |
| `PillToggle` | `ui.tsx` | on/off pill switches |
| `SliderField` | `SliderField.tsx` | numeric range settings |
| `Icon*` set | `icons.tsx` | **all emoji/unicode glyphs in controls** |

`<UiStyles />` is mounted once in `App.tsx`. Never use emoji (🖼 ✎ ⧉ …) as button icons — add an SVG to `icons.tsx` instead (16-grid, stroke 1.4, round caps), matching the sidebar icon style.

## Fonts

**Monospace** (`var(--font-mono)`) for everything that is data:
- Response text
- Model names in tables/cards
- All metric values (TTFS, latency, token counts)
- Run IDs
- Latency bars
- Code
- Input/output in prompts

**Sans-serif** (`var(--font-sans)`) for UI chrome only:
- Page headings
- Nav labels
- Button labels
- Modal titles
- Section headers

## Colors

Use CSS custom properties from `tokens.css`. Never hardcode hex values in component files.

```css
/* Backgrounds — in order of elevation */
var(--bg-sidebar)    /* sidebar only */
var(--bg-base)       /* main page background */
var(--bg-elevated)   /* cards, table rows on hover, modals */

/* Text — in order of importance */
var(--text-bright)   /* active nav, headings, important values */
var(--text-primary)  /* body text, response content */
var(--text-secondary)/* labels, secondary info */
var(--text-muted)    /* placeholders, timestamps, disabled */

/* Accent — purple, used sparingly */
var(--accent)        /* primary buttons, active nav bar, focus ring, selected chips */
var(--accent-bg)     /* selected chip background, active item bg */
var(--on-accent)     /* text/icons sitting on an accent background — never hardcode #fff */

/* Overlays */
var(--overlay)       /* modal / expanded-view backdrop — theme-aware, never rgba literals */
```

**Rule**: purple (`--accent`) appears only on interactive states and the "fastest" highlight. Everything else is grayscale.

## Type Scale

Use `--fs-*` tokens instead of ad-hoc pixel sizes:
`--fs-xs` 10 (micro-labels/badges) · `--fs-sm` 11 (table meta, chips) · `--fs-md` 12 (UI controls) · `--fs-base` 13 (body/responses) · `--fs-lg` 15 (card titles) · `--fs-xl` 20 (page headings) · `--fs-2xl` 24 (hero).

## Borders

- Always `0.5px solid var(--border)`
- On hover: `0.5px solid var(--border-hover)`
- **Zero box-shadows anywhere** — borders create depth
- Border radius: `var(--radius-sm)` inputs/badges, `var(--radius-md)` cards/tiles, `var(--radius-lg)` modals

## Spacing

Use only values from the scale: `4 / 8 / 12 / 16 / 24 / 32 / 48px`.  
No arbitrary values like `px`, `10px`, `15px`, `20px`.

## Tables

- Column headers: 10px, uppercase, `letter-spacing: 0.08em`, `var(--text-muted)`
- Cells: 12px monospace, `var(--text-primary)` or `var(--text-secondary)`
- Row actions (open, fork, delete): hidden at `opacity: 0`, reveal on row hover `opacity: 1`
- Hover row background: `var(--bg-elevated)`
- Row separator: `0.5px solid var(--border)`

## Buttons

| Type | Style |
|---|---|
| Primary | `background: var(--accent)`, white text |
| Secondary | `background: none`, `border: 0.5px solid var(--border-hover)`, `var(--text-secondary)` |
| Ghost | No border, `var(--text-muted)`, use for nav/inline actions |
| Danger | `border: 0.5px solid var(--border)`, `color: var(--error)` |

Disabled state: `opacity: 0.5`, `cursor: not-allowed`.

## Sidebar Navigation

Active item:
```css
color: var(--text-bright);
border-left: 2px solid var(--accent);
```

Inactive item:
```css
color: var(--text-muted);
border-left: 2px solid transparent;
```

Font: `var(--font-sans)`, 12px, uppercase, `letter-spacing: 0.04em`.

## Inline Styles vs CSS

This project uses inline styles for component-level styling (no CSS Modules, no styled-components).  
Use `tokens.css` CSS variables everywhere. Example:

```tsx
<div style={{
  background: 'var(--bg-elevated)',
  border: '0.5px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--sp-4)',
}}>
```

## Status Indicators

| State | Color |
|---|---|
| Connected / done | `var(--success)` — `#5ab87a` |
| Running / live | `var(--accent)` — `#7F77DD` |
| Error | `var(--error)` — `#e05c5c` |
| Warning | `var(--warning)` — `#d4944a` |
| Pending / inactive | `var(--text-muted)` — `#555` |

Status dots: `width: 7px; height: 7px; border-radius: 50%` — no text, color only.
