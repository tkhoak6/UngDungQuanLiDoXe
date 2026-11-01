# Design System Inspired by Ant

> Category: Professional & Corporate
> Structured, enterprise-focused design system emphasizing clarity, consistency, and efficiency for data-dense web applications.

## 1. Visual Theme & Atmosphere

Structured, enterprise-focused design system emphasizing clarity, consistency, and efficiency for data-dense web applications.

- **Visual style:** data-dense, enterprise
- **Color stance:** primary, neutral, success, warning, danger
- **Design intent:** Keep outputs recognizable to this style family while preserving usability and readability.

## 2. Color

- **Primary:** `#1677FF` — Token from style foundations.
- **Secondary:** `#8B5CF6` — Token from style foundations.
- **Success:** `#16A34A` — Token from style foundations.
- **Warning:** `#D97706` — Token from style foundations.
- **Danger:** `#DC2626` — Token from style foundations.
- **Surface:** `#FFFFFF` — Token from style foundations.
- **Text:** `#111827` — Token from style foundations.
- **Neutral:** `#FFFFFF` — Derived from the surface token for official format compatibility.

- Favor Primary (#1677FF) for CTA emphasis.
- Use Surface (#FFFFFF) for large backgrounds and cards.
- Keep body copy on Text (#111827) for legibility.

## 3. Typography

- **Scale:** 12/14/16/20/24/32
- **Families:** primary=Plus Jakarta Sans, display=Plus Jakarta Sans, mono=JetBrains Mono
- **Weights:** 100, 200, 300, 400, 500, 600, 700, 800, 900
- Headings should carry the style personality; body text should optimize scanability and contrast.

## 4. Spacing & Grid

- **Spacing scale:** 4/8/12/16/24/32
- Keep vertical rhythm consistent across sections and components.
- Align columns and modules to a predictable grid; avoid ad-hoc offsets.

## 5. Layout & Composition

- Prefer clear content blocks with consistent internal padding.
- Keep hierarchy obvious: headline → support text → primary action.
- Use whitespace to separate concerns before adding borders or shadows.

## 6. Components

- Buttons: primary action uses `#1677FF`; secondary actions stay neutral.
- Inputs: strong focus-visible states, clear labels, and predictable error messaging.
- Cards/sections: use consistent radii, spacing, and elevation strategy across the page.

## 7. Motion & Interaction

- Use subtle transitions that emphasize Primary (#1677FF) as the interaction signal.
- Default to short, purposeful transitions (150–250ms) with stable easing.
- Ensure hover, focus-visible, active, disabled, and loading states are explicit.

## 8. Voice & Brand

- Tone should reflect the visual style: concise, confident, and product-specific.
- Keep microcopy action-oriented and avoid generic filler language.
- Preserve the style identity in headlines while keeping UI labels literal and clear.

## 9. Anti-patterns

- Do not introduce off-palette colors when an existing token can solve the problem.
- Do not flatten hierarchy by using the same type size/weight for all text.
- Do not add decorative effects that reduce readability or accessibility.
- Do not mix unrelated visual metaphors in the same interface.

## 10. Parking App Mapping (Desktop / Electron, min 1280px)

> App shell: left sidebar 240px + topbar 56px + content area. All status colors map strictly from §2 tokens — no new hues.

### 10.1 Spot / Zone status → token mapping

| Status | Token | Usage |
| ------ | ----- | ----- |
| Trống (free) | Success `#16A34A` | Badge dot + tinted bg `rgba(22,163,74,0.08)`, border `rgba(22,163,74,0.32)` |
| Đang đỗ (occupied) | Primary `#1677FF` | Solid/filled slot on map; badge tint `rgba(22,119,255,0.10)` |
| Sắp hết / Gần đầy (occupancy ≥ 85%) | Warning `#D97706` | Zone card banner + badge tint `rgba(217,119,6,0.10)` |
| Đầy (100%) | Danger `#DC2626` | Zone card banner + disable "Check-in" CTA |
| Bảo trì / Khóa (maintenance) | Text `#111827` at 40% + Danger outline | Hatched/disabled slot, `aria-disabled`, label "Bảo trì" |
| Vé tháng hết hạn / sắp hết hạn (≤7 ngày) | Warning `#D97706` → Danger `#DC2626` khi quá hạn | Row badge in monthly-ticket table |

- Contrast: badge text always on tinted bg uses the solid token darkened to hit ≥4.5:1 (e.g. Success text `#15803D` on tint). Never white-on-tint.
- Map legend is mandatory on every occupancy visual (Guest + Dashboard).

### 10.2 Role → navigation map

- Admin: Dashboard, Khu vực, Check-in/out, Vé tháng, Báo cáo, Lịch sử, (Cài đặt giá — inside Khu vực form).
- Nhân viên: Dashboard (compact), Check-in/out (default landing), Vé tháng (gia hạn only), Lịch sử ca trực.
- Khách: Guest view only — no sidebar, header + auto-refresh map (30s), read-only.

### 10.3 Desktop conventions

- Window min 1280×720. Content max 1200px, 24px gutters. Sidebar fixed; content scrolls.
- Focus-visible: 2px solid Primary `#1677FF`, offset 2px, radius inherits. Never remove outline.
- Motion: 150–250ms `ease-out`; `prefers-reduced-motion` → instant.
- Mono (JetBrains Mono) for: biển số xe, mã vé, số tiền, timestamp.
