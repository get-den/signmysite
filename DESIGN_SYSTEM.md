# signmysite Design System

signmysite is flat, rounded, fast, and personal. The visual target is a friendly overlap
between Linktree simplicity, ChatGPT clarity, and Dribbble discovery grids.

## Principles

- **Flat first:** prefer solid fills, hairline borders, and whitespace over heavy depth.
- **Big rounded shapes:** cards use 24–34px radii; buttons and compact controls are pills.
- **Black primary actions:** the clearest action is black-on-white or white-on-black.
- **Image-led discovery:** site cards lead with large rounded previews and compact metadata.
- **Tiny motion:** hover lifts are 1–3px and transitions stay under 200ms.
- **Widget independence:** the widget is vanilla JavaScript in a shadow DOM; no React, no host CSS.

## Tokens

The shared stylesheet lives in `site/app.css`.

```css
:root {
  --bg: #f7f6f2;
  --surface: #ffffff;
  --surface-2: #f0eee8;
  --ink: #0a0a0a;
  --text: #2d2d2a;
  --muted: #74746f;
  --faint: #a7a7a0;
  --line: #e5e2da;
  --black: #000000;
  --white: #ffffff;
  --radius: 24px;
  --radius-lg: 34px;
  --shadow: 0 18px 60px rgba(20, 20, 20, 0.08);
}
```

Accent cards use soft editorial colors: blush, mint, blue, yellow, violet, and cyan.

## Components

- **Buttons:** pill-shaped, 44px minimum height, bold Inter, black for primary.
- **Cards:** white or translucent white, 1px soft border, 24–34px radius.
- **Discovery cards:** large preview image, circular avatar, bold title, compact save/view stats.
- **Tabs:** pill group with white active tab on a soft recessed background.
- **Widget card:** 430px floating profile card with avatar, circular Save ribbon, Follow button, stats, notes, and composer.

## Interaction

- Names and stat labels underline on hover.
- Cards lift subtly on hover.
- Save is independent from Follow everywhere.
- “Saved” is a first-class stat next to views, followers, and following.
