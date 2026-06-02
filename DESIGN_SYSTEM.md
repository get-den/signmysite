# Den — Design System Export

A portable spec of the visual language used by the Den app (`getden.io`). Drop the
CSS blocks below into another project and you'll reproduce the color theme, borders,
shadows, radii, typography, and component conventions exactly.

- **Framework in source:** SvelteKit + **Tailwind CSS v4** (CSS-first `@theme`, no `tailwind.config.js`).
- **Theming:** CSS custom properties. Light = `:root`, dark = `.dark` class on `<html>`.
  Dark mode is toggled by adding/removing `class="dark"` on `documentElement`
  (driven by a `themeSource` value of `system | light | dark` in `localStorage`).
- **Font:** Inter (weights 100–900), with a system-font fallback stack.
- **The golden rule:** never hardcode a color. Always reference a semantic token
  (`var(--labelTitle)`, `bg-bgBase`, etc.). The base `color` is intentionally set to
  `darkred` so any un-themed text screams at you.

---

## 1. Tech-agnostic quick reference

If you're not on Tailwind v4, these are the raw numbers that define the look:

| Thing | Value |
|---|---|
| Default border | **0.5px solid** `var(--bgBorderSolid)` (the signature "hairline" look) |
| Heavier border | `1px solid` `var(--bgBorderSolid)` (inputs, checkboxes) |
| Default radius (`--radius-sm` / `rounded-sm`) | **5px** |
| Common radii | 4px (code/badges), 5px (controls), 6–7px (menus/cards), 10px (modals), `full` (avatars/pills) |
| Standard transition | **117ms ease** (`transition-out` utility) |
| Quick transition | **67ms ease** (hover states, menu items) |
| Modal / overlay transition | **167ms** `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| Body text size | 15px / line-height 130% |
| Base font | `Inter`, fallback `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …` |
| Mobile breakpoint | `max-width: 768px` |

---

## 2. Color theme

Semantic tokens. Every UI color comes from one of these — there are no ad-hoc hex
values in components. Naming convention:

- `bg*` — surfaces & fills (`bgBase`, `bgSub`, `bgSelected`, `bgError`…).
- `label*` — text/foreground (`labelTitle`, `labelBase`, `labelMuted`, `labelFaint`…).
- `control*` — interactive accents (buttons, the primary brand purple/indigo).
- `border*` — borders.

The brand accent (`controlBase`) is the indigo **`#6f79d9`** — identical in light & dark.

### 2.1 Light theme (`:root`)

```css
:root {
	background-color: var(--bgSub);
	--boxShadowBase: 0 2px 10px rgba(0, 0, 0, 0.1);

	/* surfaces */
	--bgBase: #ffffff;
	--bgBaseHover: #fafaf9;
	--bgBaseHoverSecondary: #e3dfff;
	--bgBaseOffBase: #f9f8f6;
	--bgBaseSecondary: #e8e6fb;
	--bgSub: #f2f0ed;
	--bgSubHover: #dddbd8;
	--bgSubActive: #cdc9c3;
	--bgShade: #ebe9e6;

	/* borders */
	--bgBorder: #f0f1f5;
	--bgBorderSolid: #e0e1e5;
	--bgBorderDark: #c9c9cd;

	/* selection / highlight */
	--bgSelected: #f0f4ff;
	--bgSelectedBorder: #cad3ff;
	--bgSelectedFaint: #f9faff;
	--bgSelectedHover: #e2ebfc;
	--bgSelectedSecondary: #d7d1f9;
	--bgHighlighted: #fdf4dd;

	/* status: error */
	--bgError: #ffebeb;
	--bgErrorBorder: #ffb8b8;
	--bgErrorHover: #ffe0e0;
	--labelError: #d93636;
	--labelErrorHover: #c42929;

	/* status: success */
	--bgSuccess: #f0f8f0;
	--bgSuccessBorder: #b8d9b8;
	--bgSuccessHover: #e6f4e6;
	--labelSuccess: #3a903a;
	--labelSuccessHover: #327d32;

	/* status dots */
	--bgStatusActive: #2f9228;
	--bgStatusOffline: #6b7280;

	/* control / brand accent (indigo) */
	--controlBase: #6f79d9;
	--controlBaseHover: #5c68c9;
	--controlBaseActive: #4e59aa;
	--controlBaseFaint: #dee2ff;
	--controlBaseSelected: #e3dfff86;
	--controlBorderBase: #6771ca;
	--controlLabel: #ffffff;
	--controlSelectLabel: #1d2fb9;
	--controlSelectedBg: #e9edfb;
	--controlSecondary: #ffffff;
	--controlSecondaryHover: #f9f9f7;
	--controlSecondaryActive: #f4f4ee;

	/* text / labels */
	--labelTitle: #282a30;
	--labelBase: #3c4149;
	--labelMuted: #6c6a63;
	--labelFaint: #918e87;
	--labelFaintFaint: rgba(145, 142, 135, 0.54);
	--labelRenameMe: #90959d;
	--labelLink: #2161dc;
	--labelOrange: #e07425;
	--labelOrangeHover: #cc5f1a;

	--alphaBlack: #0d0d0d; /* "ink" that flips to near-white in dark */

	/* misc */
	--yellowHighlight: linear-gradient(
		to bottom, transparent 5%, #ffd54f 5%, #ffd54f 85%, transparent 85%
	);
	--modalOverlay: rgba(153, 151, 148, 0.425);
}
```

### 2.2 Dark theme (`.dark`)

```css
.dark {
	--boxShadowBase: 0 2px 10px rgba(0, 0, 0, 0.3);

	/* surfaces */
	--bgBase: #1c1c1f;
	--bgBaseHover: #242428;
	--bgBaseHoverSecondary: #38315b;
	--bgBaseOffBase: #262629;
	--bgBaseSecondary: #282342;
	--bgSub: #2a2a2d;
	--bgSubHover: #353538;
	--bgSubActive: #404043;
	--bgShade: #323236;

	/* borders */
	--bgBorder: #2d2d33;
	--bgBorderSolid: #3f3f45;
	--bgBorderDark: #62626c;

	/* selection / highlight */
	--bgSelected: #353b51;
	--bgSelectedBorder: #3a4266;
	--bgSelectedHover: #303a55;
	--bgSelectedSecondary: #423b6b;
	--bgHighlighted: #443c24;

	/* status: error */
	--bgError: #3d2029;
	--bgErrorBorder: #5a2f3a;
	--bgErrorHover: #4a2832;
	--labelError: #c65d5d;
	--labelErrorHover: #e07575;

	/* status: success */
	--bgSuccess: #243124;
	--bgSuccessBorder: #3a4a3a;
	--bgSuccessHover: #2a3a2a;
	--labelSuccess: #5fb85f;
	--labelSuccessHover: #7fd47f;

	/* status dots */
	--bgStatusActive: #43a93c;
	--bgStatusOffline: #4a4e5a;

	/* control / brand accent (indigo — same base hue) */
	--controlBase: #6f79d9;
	--controlBaseHover: #8892e2;
	--controlBaseActive: #939ef2;
	--controlBaseFaint: #313363;
	--controlBaseSelected: #252143;
	--controlBorderBase: #8088d1;
	--controlLabel: #ffffff;
	--controlSelectLabel: #8b98e8;
	--controlSelectedBg: #2e3453;
	--controlSecondary: #1c1c1f;
	--controlSecondaryHover: #252529;
	--controlSecondaryActive: #313137;

	/* text / labels */
	--labelTitle: #e6e7eb;
	--labelBase: #c8c9cf;
	--labelMuted: #9a9ba3;
	--labelFaint: #7c7d85;
	--labelFaintFaint: rgba(124, 125, 133, 0.38);
	--labelRenameMe: #90959d;
	--labelLink: #6f97e6;
	--labelOrange: #f59e0b;
	--labelOrangeHover: #ffb020;

	--alphaBlack: #f7f7f5;

	/* misc */
	--yellowHighlight: linear-gradient(
		to bottom, transparent 5%, #664e14 5%, #664e14 85%, transparent 85%
	);
	--modalOverlay: rgba(18, 20, 22, 0.85);
}
```

### 2.3 Token cheat-sheet (when do I use which?)

| Token | Use for |
|---|---|
| `bgBase` | The primary content surface (cards, panels, modals, menus). |
| `bgSub` | The app backdrop / recessed surface behind `bgBase`. Also hover bg for ghost items. |
| `bgBaseOffBase` | Subtle alternating/inset surface (e.g. skeleton base). |
| `bgBaseHover` / `bgSubHover` | Hover states for base / sub surfaces. |
| `bgBorder` | Faint dividers, default input border. |
| `bgBorderSolid` | The standard visible hairline border (cards, menus, modals). |
| `bgBorderDark` | Stronger border when you need contrast. |
| `bgSelected*` | Selected rows/items (soft blue tint). |
| `controlBase` | Primary buttons, focus rings, checked checkboxes, accent. |
| `labelTitle` | Headings & high-emphasis text; also the caret color. |
| `labelBase` | Default body text. |
| `labelMuted` | Secondary text. |
| `labelFaint` | Placeholder/disabled/tertiary text & icons. |
| `labelLink` | Hyperlinks. |

### 2.4 Random avatar/identity palette

For per-user/per-entity colors (`getRandomColorFromId()`), there's a 32-swatch palette
(`--random-color-0` … `--random-color-31`), tuned brighter in dark mode. Light examples:
`rgb(224,81,148)`, `rgb(42,161,152)`, `rgb(108,92,231)`, `rgb(225,112,85)`,
`rgb(46,204,113)`, `rgb(52,152,219)` … (full list in `colors/light.css` & `dark.css`).

---

## 3. Borders

The defining trait of this UI is the **0.5px hairline border**.

| Context | Border |
|---|---|
| Cards, menus, modals, popovers | `border: 0.5px solid var(--bgBorderSolid)` → Tailwind `border-[0.5px] border-bgBorderSolid` |
| App-level bottom divider | `.app-bottom-border { border-bottom: 0.5px solid var(--bgBorderSolid); }` |
| Inputs, checkboxes, radios | `1px solid var(--bgBorderSolid)` |
| Buttons (primary) | `border-[0.5px] border-controlBorderBase` |
| Buttons (secondary) | `border-[0.5px] border-bgBorderSolid` |
| Error surfaces | `border-[0.5px] border-bgErrorBorder` |
| Footers / section splits | `border-top: 0.5px solid var(--bgBorderSolid)` |
| Links (rich text) | `border-bottom: 0.5px solid var(--labelFaint)` → darkens to `--labelBase` on hover |

Usage frequency in the codebase (for calibration): `border-[0.5px]` ≫ `border-[1px]`.
When in doubt, use **0.5px**.

---

## 4. Shadows (exact)

Defined once in `colors/shared.css` and exposed to Tailwind as `shadow-small`,
`shadow-medium`, `shadow-large`, `shadow-stack-low`.

```css
:root {
	/* the everyday card/control shadow — extremely subtle */
	--shadowSmall:
		0px 4px 4px -1px rgba(0, 0, 0, 0.02),
		0px 1px 1px 0px rgba(0, 0, 0, 0.06);

	/* modals, floating panels */
	--shadowMedium: 0px 4px 24px rgba(0, 0, 0, 0.2);

	/* large overlays, command palette */
	--shadowLarge: 0px 7px 32px rgba(0, 0, 0, 0.35);

	/* layered "stack of paper" shadow */
	--shadowStackLow:
		0px 8px 2px 0px transparent,
		0px 5px 2px 0px rgba(0, 0, 0, 0.01),
		0px 3px 2px 0px rgba(0, 0, 0, 0.04),
		0px 1px 1px 0px rgba(0, 0, 0, 0.07),
		0px 0px 1px 0px rgba(0, 0, 0, 0.08);
}
```

Plus a theme-aware generic used by dropdown menus:

```css
:root  { --boxShadowBase: 0 2px 10px rgba(0, 0, 0, 0.1); }
.dark  { --boxShadowBase: 0 2px 10px rgba(0, 0, 0, 0.3); }
```

Rule of thumb: **`shadow-small` on buttons & cards, `shadow-medium` on modals,
`shadow-large` for big floating surfaces, `--boxShadowBase` on menus/popovers.**

---

## 5. Border radius

```css
@theme { --radius-sm: 5px; }   /* `rounded-sm` === 5px (overrides Tailwind default) */
```

| Radius | Where |
|---|---|
| 2–3px | tiny chips, checkbox (3px) |
| 4px | code blocks, small badges (`rounded-[4px]`) |
| **5px** | the default control radius (`rounded-sm`); menu-item hover highlight uses 5.15px |
| 6–7px | menus / dropdowns / cards (`menu-container` = 7px) |
| 9.75px | modal footer corners |
| 10px | modal container |
| `full` | avatars, pills, status dots, radio buttons |

Observed usage order: `rounded-full` ≈ `rounded-sm` ≫ `rounded-lg` > `rounded-[4px]`
> `rounded-[6px]` > `rounded-[5px]`.

---

## 6. Typography

Loaded font: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap')`.

Global fallback stack (applied to `*`):

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
	Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
font-kerning: normal;
```

Type scale — defined as utility classes (`@layer utilities`). `Plus` = medium (500),
`PlusPlus` = semibold/bold (600/700):

```css
.titleLarge      { font: 400 56px/62px; }
.titleLargePlus  { font: 500 56px/62px; }
.title           { font: 400 40px/44px; }
.titlePlus       { font: 500 40px/44px; }
.titleSmall      { font: 400 32px/36px; }
.titleSmallPlus  { font: 500 32px/36px; }
.titleMini       { font: 400 24px/32px; }
.titleMiniPlus   { font: 500 24px/32px; }
.bodyLarge       { font: 400 18px/24px; }
.bodyLargePlus   { font: 500 18px/24px; letter-spacing: -0.01em; }
.body            { font: 400 15px/130%; }   /* default body */
.bodyPlus        { font: 500 15px/130%; }
.bodySmall       { font: 400 14px; }
.bodySmallPlus   { font: 500 14px; }
.bodySmallPlusPlus { font: 600 14px; }
.bodyMini        { font: 400 12px; }
.bodyMiniPlus    { font: 500 12px; }
.bodyMiniPlusPlus{ font: 700 12px; }
```

Rich-text (editor/markdown) sizes: `h1` 32px/48px, `h2` 24px/40px, `h3` 18px/32px
(all weight 700, color `labelTitle`), paragraphs 15px / line-height 155%.

---

## 7. Motion & transitions

```css
/* shared.css */
--transition-standard: 1500ms;            /* long ambient transitions */

/* utility-classes.css */
.duration-standard { transition-duration: 117ms; }
.transition-out    { transition: all 117ms ease; }
.transition-out:hover { transition: none; }   /* snap on hover-in, ease on hover-out */
```

JS timing constants (`transitions.ts`): `DELAY_INSTANT = 30ms`, `DELAY_QUICK = 67ms`,
default slide/fade `167ms`.

| Interaction | Timing |
|---|---|
| Button / general hover | 117ms ease (`transition-out`) |
| Menu item / quick hover | 67ms ease |
| Checkbox/radio | 67–150ms ease-in-out |
| Modal zoom + backdrop fade | 167ms `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| Menu open/close | 117ms ease, scale 0.9 → 1 + opacity |
| Mobile sheet | `slide-up` / `slide-down` 167ms |
| Fade-in entrance | `fadeIn` 0.2s — opacity 0→1 + translateY(4px)→0 |

---

## 8. Component conventions

### 8.1 Buttons

Variants: `primary | secondary | naked | error`. Sizes: `xsmall | small | regular | large`.
Base: `rounded-sm transition-out flex items-center justify-center`.

```
primary:   border-[0.5px] shadow-small bg-controlBase text-controlLabel
           border-controlBorderBase  · hover:bg-controlBaseHover · active:bg-controlBaseActive
           disabled: opacity-50, no border, no shadow
secondary: border-[0.5px] shadow-small border-bgBorderSolid bg-controlSecondary
           hover:bg-controlSecondaryHover · active:bg-controlSecondaryActive · text labelTitle
naked:     bg-transparent border-none · hover:bg-bgSub · active:bg-bgSubHover · text labelMuted
error:     border-[0.5px] shadow-small border-bgErrorBorder text-labelError
           hover:bg-bgError · active:bg-bgErrorHover
```

Sizing (height / padding-x / min-width / icon px):

| size | height | px | icon | text class |
|---|---|---|---|---|
| xsmall | 20px | 5px | 12 | bodyMini |
| small | 24px | 8px | 14 | bodyMini |
| regular | 28px | 10px | 16 | bodySmall |
| large | 32px | 14px | 18 | body |

Icon-only buttons are square (`h × h`, `p-0`). On mobile, button sizes bump up one level
automatically. Gap between icon+label: 4px (xs/sm), 6px (regular), 8px (large).

### 8.2 Inputs, checkboxes, radios

```css
input[type='checkbox'] {
	appearance: none;
	width: 14px; height: 14px;
	border-radius: 3px;
	border: 1px solid var(--bgBorderSolid);
	transition: all 150ms ease-in-out;
}
input[type='checkbox']:checked {
	background: var(--controlBase) url('/icons/checkbox-checked.svg') center/10px no-repeat;
	border-color: var(--controlBase);
}
input[type='radio'] { /* same box, border-radius: 50%; 6px white dot when :checked */ }

input::placeholder { color: var(--labelFaint); opacity: 0.7; }
```

### 8.3 Focus ring (the signature focus treatment)

```css
.focus-ring { border: 1px solid var(--bgBorder); outline: transparent solid 2px; transition-duration: 150ms; }
.focus-ring:focus-within {
	border: 1px solid transparent;
	box-shadow: 0 0 0 1px var(--controlBase);   /* crisp 1px accent ring */
	outline: 4px solid var(--controlBaseFaint);  /* soft halo */
	outline-offset: 1.25px;
}
```

### 8.4 Menus / dropdowns / popovers

```css
.menu-container {
	background: var(--bgBase);
	border: 0.5px solid var(--bgBorderSolid);
	border-radius: 7px;
	box-shadow: var(--boxShadowBase);
	animation: menuOpen 117ms ease forwards;   /* scale 0.9 → 1, opacity 0 → 1, origin top-left */
}
[role='menuitem'] {
	height: 31px; padding: 7px 10px;
	font-size: 12px; font-weight: 500; color: var(--labelBase);
	transition: background-color 67ms ease;
}
/* hover highlight is an inset ::before pill, not the row itself */
[role='menuitem']:hover::before { background: var(--bgSub); border-radius: 5.15px; inset: 1px 4px; }
```

### 8.5 Modals

```css
.modal-backdrop  { background: var(--modalOverlay); animation: fade 167ms ease-out; }
.modal-container {
	width: 32rem; max-width: 90vw; max-height: 90vh;
	background: var(--bgBase);
	border: 0.5px solid var(--bgBorderSolid);
	border-radius: 10px;
	box-shadow: var(--shadow-medium);
	animation: zoom 167ms cubic-bezier(0.25, 0.46, 0.45, 0.94);  /* scale 0.95 → 1 */
}
/* footer */
footer {
	padding: 0.65rem 0.875rem;
	background: var(--bgBaseHover);
	border-top: 0.5px solid var(--bgBorderSolid);
	border-radius: 0 0 9.75px 9.75px;
}
/* < 768px: full-screen, no radius/border, slide-up from bottom */
```

Widths: default `32rem`, `.custom-wide` `42rem`, `.wide` `64rem` (capped 800px).

### 8.6 Scrollbars

```css
::-webkit-scrollbar { width: 5px; background: transparent; }
::-webkit-scrollbar-thumb { background: var(--bgSubActive); border-radius: 0; opacity: 0.8; }
* { scrollbar-width: thin; scrollbar-color: var(--bgSubActive) transparent; }
.hide-scrollbar { scrollbar-width: none; }   /* + ::-webkit-scrollbar { display:none } */
```

### 8.7 Loading skeletons

Shimmer gradient swept across placeholder blocks:

```css
background: linear-gradient(90deg, var(--bgBaseOffBase) 25%, var(--bgBorder) 50%, var(--bgBaseOffBase) 75%);
background-size: 200% 100%;
animation: skeleton-loading 1.5s infinite;   /* background-position 200% → -200% */
border-radius: 6px;
```

### 8.8 Misc effects

- **`.shiny-text`** — animated shimmering text (clip gradient `labelFaint → labelTitle → labelFaint`, 4s loop). Used for "thinking"/loading labels.
- **`.highlight-element-on-navigate`** — flashes `bgHighlighted` then fades to transparent over 4s to draw the eye to a target.
- **`.typing-dots::after`** — animated `.` / `..` / `...` (900ms loop).
- **`.container-gradient*`** — `mask-image` linear gradients to fade content edges (top/bottom or right).
- **`--yellowHighlight`** — text-highlighter marker gradient (used on edited messages).

---

## 9. Drop-in Tailwind v4 `@theme` bridge

This is what maps the CSS variables above to Tailwind utility classes
(`bg-bgBase`, `text-labelTitle`, `border-bgBorderSolid`, `shadow-small`, `rounded-sm`, …).
Paste after importing the color files.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap');
@import 'tailwindcss';

/* import your colors/light.css, colors/dark.css, shared.css here first */

@theme {
	/* surfaces */
	--color-bgBase: var(--bgBase);
	--color-bgBaseSecondary: var(--bgBaseSecondary);
	--color-bgBaseHover: var(--bgBaseHover);
	--color-bgBaseHoverSecondary: var(--bgBaseHoverSecondary);
	--color-bgBaseOffBase: var(--bgBaseOffBase);
	--color-bgSub: var(--bgSub);
	--color-bgSubHover: var(--bgSubHover);
	--color-bgSubActive: var(--bgSubActive);
	--color-bgShade: var(--bgShade);

	/* borders */
	--color-bgBorder: var(--bgBorder);
	--color-bgBorderSolid: var(--bgBorderSolid);
	--color-bgBorderDark: var(--bgBorderDark);

	/* selection / status */
	--color-bgSelected: var(--bgSelected);
	--color-bgSelectedSecondary: var(--bgSelectedSecondary);
	--color-bgSelectedHover: var(--bgSelectedHover);
	--color-bgSelectedFaint: var(--bgSelectedFaint);
	--color-bgSelectedBorder: var(--bgSelectedBorder);
	--color-bgHighlighted: var(--bgHighlighted);
	--color-bgError: var(--bgError);
	--color-bgErrorBorder: var(--bgErrorBorder);
	--color-bgErrorHover: var(--bgErrorHover);
	--color-bgSuccess: var(--bgSuccess);
	--color-bgSuccessBorder: var(--bgSuccessBorder);
	--color-bgSuccessHover: var(--bgSuccessHover);
	--color-bgStatusActive: var(--bgStatusActive);
	--color-bgStatusOffline: var(--bgStatusOffline);

	/* labels / text */
	--color-labelTitle: var(--labelTitle);
	--color-labelBase: var(--labelBase);
	--color-labelMuted: var(--labelMuted);
	--color-labelFaint: var(--labelFaint);
	--color-labelFaintFaint: var(--labelFaintFaint);
	--color-labelRenameMe: var(--labelRenameMe);
	--color-labelLink: var(--labelLink);
	--color-labelError: var(--labelError);
	--color-labelErrorHover: var(--labelErrorHover);
	--color-labelOrange: var(--labelOrange);
	--color-labelOrangeHover: var(--labelOrangeHover);
	--color-labelSuccess: var(--labelSuccess);
	--color-labelSuccessHover: var(--labelSuccessHover);

	/* controls / brand accent */
	--color-controlBase: var(--controlBase);
	--color-controlBaseHover: var(--controlBaseHover);
	--color-controlBaseActive: var(--controlBaseActive);
	--color-controlBaseFaint: var(--controlBaseFaint);
	--color-controlBaseSelected: var(--controlBaseSelected);
	--color-controlBorderBase: var(--controlBorderBase);
	--color-controlLabel: var(--controlLabel);
	--color-controlSelectLabel: var(--controlSelectLabel);
	--color-controlSelectedBg: var(--controlSelectedBg);
	--color-controlSecondary: var(--controlSecondary);
	--color-controlSecondaryHover: var(--controlSecondaryHover);
	--color-controlSecondaryActive: var(--controlSecondaryActive);
	--color-alphaBlack: var(--alphaBlack);

	/* shadows */
	--shadow-small: var(--shadowSmall);
	--shadow-medium: var(--shadowMedium);
	--shadow-large: var(--shadowLarge);
	--shadow-stack-low: var(--shadowStackLow);

	/* radius */
	--radius-sm: 5px;
}
```

---

## 10. File map (where this lives in the source)

| File | Contents |
|---|---|
| `src/app.css` | Entry point: imports + `@theme` bridge (§9) |
| `src/styles/colors/light.css` | `:root` light tokens + random palette (§2.1) |
| `src/styles/colors/dark.css` | `.dark` dark tokens (§2.2) |
| `src/styles/colors/shared.css` | Shadows + shared vars (§4) |
| `src/styles/utility-classes.css` | Typography scale + `transition-out` (§6, §7) |
| `src/styles/forms.css` | Checkbox/radio/focus-ring (§8.2, §8.3) |
| `src/styles/miscellaneous.css` | Menus, scrollbars, skeletons, effects (§8.4, §8.6–8.8) |
| `src/styles/modal.css` | Modal/backdrop/footer (§8.5) |
| `src/styles/rich-text.css` | Editor/markdown typography |
| `src/lib/components/buttons/Button.svelte` | Button variants & sizes (§8.1) |
| `src/app.html` | Dark-mode bootstrap script (`themeSource` → `.dark`) |
