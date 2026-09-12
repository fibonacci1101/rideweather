# Handoff: Ride Weather App — UI Redesign

> **Note (added later):** This handoff describes the UI as of the 2026-08 redesign. The route map has since been
> reimplemented with Leaflet (`react-leaflet`) drawing the track directly, replacing the Ride with GPS iframe embed
> that this document assumes. See `docs/DESIGN.md` section 4.5 for that decision.

## Overview
Visual redesign of the existing Ride Weather App single-page screen (route input form → route map → weather forecast cards). The goal is to move the current default MUI look to a more considered visual system while keeping all existing functionality, data, and component boundaries (`InputForm`, `RouteMap`, `WeatherDisplay`, `ExportImageButton`).

## About the Design Files
The file in this bundle (`Home.dc.html`) is a **design reference built in HTML** — a prototype of the intended look, not production code to copy directly. The task is to **recreate this design inside the existing React + MUI codebase**, using MUI's theming system (`createTheme`) plus targeted `sx`/styled overrides on top of the existing components — not a rewrite in a new framework. The codebase's structure (`InputForm.tsx`, `RouteMap.tsx`, `WeatherDisplay.tsx`, `App.tsx`) should stay as-is; only styling and a couple of small structural additions (summary banner, per-card warning state) are new.

## Fidelity
**High-fidelity.** Colors, spacing, radii, and typography below are final. Recreate pixel-close using MUI's theme + `sx` overrides, not a from-scratch design pass.

## Screens / Views
Single screen, three stacked sections.

### 1. Header
- App label: "Ride Weather App" — 13px, weight 700, uppercase, letter-spacing 0.04em, color `oklch(45% 0.13 160)`
- Title: "ルート天気予報" — 30px (24px under 640px), weight 800
- Subtitle: 14px, color `oklch(48% 0.02 160)`

### 2. Input form (maps to `InputForm.tsx`)
- White card, 20px border-radius, padding 28px, shadow `0 1px 3px rgba(0,0,0,0.06)`
- Fields in a 4-column grid on desktop (`2fr 1fr 1fr 1fr`: route ID/URL, date, time, avg speed), stacking to 1 column under 640px
- Each field: 12px/700 label above a 44px-tall input, 10px radius, 1px border `oklch(88% 0.01 160)`
- Submit button right-aligned below the grid: solid `oklch(30% 0.05 160)` background, white text, 10px radius, 12px/24px padding, weight 700
- Time/avg-speed fields only show when a future date is selected (existing `isFutureDate` logic) — no design change to that logic, just style the shown/hidden fields the same way

### 3. Route map (maps to `RouteMap.tsx`)
- 16:6 aspect ratio (4:3 under 640px), 20px border-radius, container for the existing RWGPS iframe embed — no visual chrome needed around the iframe itself beyond the rounded corners

### 4. Summary banner (new — insert between map and forecast cards)
- Only rendered when at least one point crosses the warning thresholds (see below)
- Background `oklch(93% 0.05 60)`, 14px radius, padding 14px/18px, flex row with an 8px warning dot (`oklch(58% 0.15 40)`) and a 13px text line naming the affected leg and the reason (e.g. "CP4〜到着地点で降水確率60%以上・風速4m/s超")

### 5. Forecast section header
- "天気予報" — 20px, weight 800, left
- "画像として保存" export button (maps to `ExportImageButton.tsx`) — right, white background, 1px border `oklch(85% 0.02 160)`, 10px radius, 13px/700 text, color `oklch(30% 0.05 160)`

### 6. Weather cards (maps to `WeatherDisplay.tsx`)
- Grid: `repeat(auto-fill, minmax(230px, 1fr))`, 14px gap — collapses naturally to 1–2 columns on phone widths
- Card: white, 16px radius, 18px padding, shadow `0 1px 3px rgba(0,0,0,0.06)`, 1.5px border (see warning state)
- Card content top to bottom:
  1. Point name (15px/700) + "距離: X km ・ 到着予定: HH:MM" (12px, color `oklch(50% 0.02 160)`)
  2. Divider-bound row (top/bottom 1px border `oklch(94% 0.006 160)`): 40px circular weather icon + temp (22px/800) + description and feels-like (12px)
  3. Stat rows (13px), label in `oklch(50% 0.02 160)`, value right-aligned and bold: 降水確率 (%), 風速・風向き, 降水量 (3h)
  4. Footer line: "日の出 HH:MM ・ 日の入り HH:MM", 12px, color `oklch(55% 0.02 160)`

**Warning state**: when a card's 降水確率 ≥ 50% or 風速 ≥ 4 m/s, that stat's value text turns `oklch(55% 0.16 40)` (warm amber-red) and bold, and the card border becomes `oklch(75% 0.1 40)` instead of the default `oklch(94% 0.006 160)`. This is a pure presentational rule computed from the existing weather data — no new API fields needed.

## Weather icon treatment
Simple two-tone circles (no icon library dependency needed, though existing OpenWeatherMap icons can be kept if preferred):
- Sunny: outer `oklch(90% 0.03 70)`, inner `oklch(78% 0.14 70)`
- Cloudy: outer `oklch(93% 0.01 160)`, inner `oklch(80% 0.02 160)`
- Rain: outer `oklch(90% 0.02 220)`, inner `oklch(65% 0.03 220)`

## Design Tokens
- **Font**: Manrope (Latin) — falls back to the system Japanese font stack for CJK text automatically; no change needed to `index.css`'s existing `system-ui, 'Segoe UI', Roboto` fallback for Japanese glyphs.
- **Background**: `oklch(97% 0.004 160)`
- **Text (primary)**: `oklch(18% 0.006 160)`
- **Text (muted/labels)**: `oklch(48–50% 0.02 160)`
- **Accent (primary/dark teal)**: `oklch(30% 0.05 160)` — buttons, app label at `oklch(45% 0.13 160)`
- **Warning**: `oklch(55–58% 0.15–0.16 40)`
- **Card radius**: 16px; form card radius: 20px; inputs/buttons: 10px
- **Card shadow**: `0 1px 3px rgba(0,0,0,0.06)`

## Responsive Behavior
- Breakpoint: 640px
- Form grid: 4 columns → 1 column
- Title: 30px → 24px
- Map aspect ratio: 16:6 → 4:3
- Card grid: auto-fill already collapses to fewer columns with no explicit breakpoint needed

## Files
- `Home.dc.html` — full HTML/inline-CSS reference implementation of the screen above, with representative sample data for 6 route points. This file depends on a design-tool runtime (`support.js`) that is not included in this repository, so opening it directly will not render the sample data correctly. Refer to the two screenshots in this directory for the intended look, and read the HTML/CSS as the reference implementation.
- `screenshot-desktop.png` — desktop-width reference screenshot.
- `screenshot-mobile.png` — narrow-viewport reference screenshot (this screenshot's form fields are visually compressed rather than truly re-flowed).
