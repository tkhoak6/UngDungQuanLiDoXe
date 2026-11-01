# Review Report — RV-001 Final Integration + Security (Parking Electron App)

**Reviewer**: @reviewer · **Date**: 2026-10-16 · **Mode**: Balanced
**Sources read**: `./api-contract.md`, `./specs/schema.sql`, `./specs/seed.sql`,
`./specs/backend-summary.md`, `./specs/implementation-summary.md`, `./specs/design-qa-report.md` (§9 PASS 14/14),
`src/shared/types.ts`, `src/main/{auth,db,fee-calculator,ipc-handlers}.ts`, `src/preload/index.ts`,
`src/renderer/{types.ts,lib/api.ts,lib/fee.ts,store/auth.tsx,App.tsx,layout/AppShell.tsx,pages/*.tsx}`
**Static only** — no Node/Electron runtime in this sandbox (`console.*`/`innerHTML` grep clean, types compared by hand).
**Verification: `verified`** (review coverage complete on all 4 requested items; runtime IPC itself remains unrun — see §5).

---

## (a) API alignment — frontend channels vs backend `ApiMap`

Backend exposes 25 channels; renderer `backendApi` (via `callApi` → `window.api.invoke`) calls 13 of them.
Envelope mapping is sound: `IpcResult {success,data,message,errors?}` → `ApiResult {ok,data,error}` via `toResult`, error text preserved.

| # | Severity | Finding | Evidence | Fix pattern (for @frontend-react / @node-developer) |
| - | -------- | ------- | -------- | --------------------------------------------------- |
| A1 | **High** | **Staff hits admin-guarded IPC on Dashboard.** `DashboardPage` (staff-accessible — `App.tsx` only blocks `zones`/`revenue` for staff) calls `a.revenue()` → `reports:revenue` + `reports:sessions-daily`, both `guard:'admin'` → staff sees "Chỉ Admin…" failure on chart/KPI. Backend already has staff-safe `reports:dashboard` (availability + active count + `revenue_today` + expiring passes) that **no page calls**. Fail-closed (no leak) but broken UX for the primary role. | `SessionsPage`/`DashboardPage` call `revenue()`; `ipc-handlers.ts:514,522` admin guard; `api.ts:240-249` | Route Dashboard widgets through `reports:dashboard`; keep `reports:revenue` for RevenuePage (admin-only, already staff-blocked in `App.tsx:42-43`). Do NOT relax the admin guard. |
| A2 | **Medium** | **`sessions:preview-fee` never called.** Checkout preview is 100% local `lib/fee.ts` (`SessionsPage:99-102`); backend preview (spec §d "bắt buộc gọi trước thu phí") has zero callers. Drift risk: client uses `monthly_pass_id !== null` as pass-valid while server revalidates dates — expired-but-linked pass shows 0đ preview, server charges full at checkout. Overnight/`day_count` edge cases also duplicated. | `api.ts` has no `preview-fee` invoke; `ipc-handlers.ts:316` idle | On checkout-select/confirm, `invoke('sessions:preview-fee', {ticket_code, discount_amount})` and render server receipt; keep `lib/fee.ts` as instant fallback while loading. |
| A3 | **Medium** | **`CheckInInput` type drift.** `src/renderer/types.ts:98-103` lacks `owner_name`/`owner_phone` present in `src/shared/types.ts:157-164` + backend upsert (`ipc-handlers.ts:246-248` reads `input.owner_name ?? ''`). Check-in form sends plate/type/zone only → every vehicle created with empty owner. | `SessionsPage:123` sends 3 fields | Either add owner fields to check-in form + renderer type, or remove them from `ApiMap` input. Do not touch anything else in the check-in flow. |
| A4 | **Medium** | **Dead IPC = features with no UI.** Zero callers: `zones:get`, `spots:set-status`, `users:list/create/toggle-active`, `payments:list`, `auth:logout`, `auth:me`, `reports:dashboard` (see A1). Consequences: (i) no Users management page though matrix §11 assigns it to admin; (ii) spot-level maintenance unreachable — ZonesPage lock toggles only zone `is_active`; Guest grid can show `maintenance` but nothing sets it; (iii) no payment-history view though `payments:list` (+`mine_only`) exists for staff shift review. | `api.ts:121-265` caller list vs `ApiMap` 25 keys; 7 renderer pages, no Users/Payments page | If out of scope for this release, record explicitly in `parking-app.md`; otherwise add minimal admin Users page + spot-status action + cashier payments view. Do not invent new channels — they already exist. |
| A5 | **Low** | **Logout doesn't clear main-process session.** `AuthProvider.logout` only resets renderer state; never `invoke('auth:logout')`. Single-operator desktop → stale `currentUser` in main until app quit. Also no `auth:me` rehydrate on reload (login state lost on refresh). | `store/auth.tsx:35-37`; `ipc-handlers.ts:139-143` idle logout/me | Call `auth:logout` on logout (fire-and-forget ok); optionally `auth:me` on boot. |
| A6 | **Low** | **`passes:list` always called bare.** Backend supports `status/search/expiring_within_days` filters; renderer passes `{}` and filters client-side (Dashboard expiring count, Passes search). Correct at current scale, wasteful later. | `api.ts:207-210` | Pass filters through when wiring A1/A4; no contract change needed. |
| — | ✅ OK | `findParked` 2-IPC fan-out (`sessions:active` + `vehicles:find`, client filter + localStorage plate cache) is acceptable for a desktop DB; documented in implementation-summary. `sessions:history` called with `{limit}` subset — valid (all other fields optional). `availability:list {}` / `spots:list {zone_id}` match signatures. | | |

---

## (b) Type compatibility — `renderer/types.ts` vs `api-contract.md` vs `shared/types.ts`

| Check | Verdict |
| ----- | ------- |
| Enums (`RoleName`, `VehicleType`, `ZoneVehicleAllowed`, `SpotStatus`, `SessionStatus`, `PassStatus`, `PaymentMethod`) | ✅ identical in all 3 files |
| 8 tables (`Role/User/ParkingZone/ParkingSpot/Vehicle/MonthlyPass/ParkingSession/Payment`) field-by-field | ✅ match (renderer `UserDTO` = contract `UserDTO` minus `password_hash` — correct) |
| 4 views (`ZoneAvailability/RevenueDaily/SessionsDaily/SpotMapCell`) | ✅ match, incl. `occupying_plate` |
| `CheckOutInput`, `Payment`, `ParkingSession` snapshots (`hourly_rate_applied`, `daily_rate_applied`, `total_fee`, `discount_amount`) | ✅ match |
| `CheckInInput` | ❌ drift — see A3 (`owner_name`/`owner_phone` missing in renderer) |
| Fee formula (≤30p→1h; else `ceil`; overnight **or** ≥12h→daily with `day_count=ceil(h/24)`; pass→0; `max(0, fee−discount)`; 12-month pack −10%) | ✅ `fee-calculator.ts` matches contract §8; renderer `lib/fee.ts` matches per summary (display-only, with the pass-validity nuance in A2) |
| `ticket_code T-YYYYMMDD-####` / `pass_code MT-YYYY-####` generation | ✅ `ticketCode`/`passCode` match contract examples |
| `SessionRow`/`PassRow` (renderer-only, add `license_plate`) | ✅ derived view-models, never sent to IPC — correct workaround until backend JOINs plates (recommended follow-up from FE still open) |

---

## (c) Auth & security

| Check | Verdict | Evidence |
| ----- | ------- | -------- |
| Plaintext passwords | ✅ none — `password_hash` only; `bcrypt.hashSync(10)` on create, `compareSync` on login | `auth.ts:51-63,92-95`, `ipc-handlers.ts:555-556` |
| Hash leak to renderer | ✅ impossible — `toUserDTO` strips `password_hash`; `users:list` SELECT omits the column; `auth:login` returns `UserDTO` | `auth.ts:27-38`, `ipc-handlers.ts:539-546` |
| Timing side-channel on unknown user | ✅ dummy-hash compare keeps timing uniform | `auth.ts:56-57` |
| IPC guards vs matrix §11 | ✅ full match — admin: `zones:create/update/delete`, `spots:set-status`, `reports:revenue/sessions-daily`, `users:*`; staff: sessions/passes/`vehicles:find`/`payments:list`/`reports:dashboard`; guest (no login): `zones:list/get`, `availability:list`, `spots:list`, `auth:*`. Handlers also re-`requireRole('staff')` to bind actor id. UI mirror ok (`App.tsx:42-43` staff-block, guest chromeless). Only hole is fail-closed A1. | `ipc-handlers.ts:117-134,187-200` |
| SQL injection | ✅ all user input parameterized (`?`); `LIKE` search parameterized; dynamic `+N days` built from `Math.max(0, int)`; no string-interpolated SQL | `ipc-handlers.ts:393-399`, search `SELECT … WHERE` audit |
| Checkout atomicity | ✅ ONE `db.transaction`: UPDATE session + UPDATE spot + INSERT payment; check-in and `sellPass` also transactional | `ipc-handlers.ts:242-276,320-346,425-458` |
| Payments append-only | ✅ no update/delete channel exists by design; `payments:list` capped 500, `mine_only` supported | `ipc-handlers.ts:581-600` |
| Error hygiene | ✅ internal errors → generic "Đã xảy ra lỗi…"; only `AppError` (Vietnamese, user-safe) surfaces; no stack/hash in responses | `ipc-handlers.ts:123-134` |
| XSS / dangerous sinks | ✅ no `dangerouslySetInnerHTML`/`innerHTML`/`eval`; React escapes by default; preload `contextIsolated`, no Node in renderer | grep clean |
| Zone delete guard | ✅ blocked when parked sessions exist; FK RESTRICT history → friendly "khóa thay vì xóa"; spot status change blocked when occupied | `ipc-handlers.ts:187-227` |

**Non-blocking security notes (Low, fix when convenient):**
1. **Default credentials in code** — `db.ts:36` maps `admin→Admin@123`, `staff01→Staff@123` and `seed.sql` ships placeholder hashes. Fine for first-boot, but **must rotate after handover** (already noted in backend-summary; repeat here so it isn't lost).
2. **No brute-force throttle** on `auth:login` — acceptable for a local single-operator app; consider a small attempt-delay later. No change requested now.
3. **`payment_method` not enum-whitelisted** in `check-out` handler — invalid value falls through to the DB `CHECK` and surfaces as a generic error. Suggest explicit whitelist for a friendly message.
4. **`passes:cancel` drops `reason`** — param accepted, never persisted (no column). Either persist to payment/note or remove the param from `ApiMap`.
5. **Missing expiry sweeper** — contract §7 says an app job flips `active→expired`; no such job exists. Billing is safe (`findValidPass` + preview both date-check), but `passes:list {status:'active'}` and any status-based UI will show long-expired passes as active. Recommend a startup sweep (`UPDATE … SET status='expired' WHERE end_date < date('now')`) or a view-based status.

---

## (d) Residual risks + manual verification commands

| # | Risk | Mitigation / owner |
| - | ---- | ------------------ |
| R1 | **Native binding never built** — `better-sqlite3` needs VS Build Tools; zero IPC paths have ever executed. Checkout transaction, guards, and seed bootstrap are review-only until run. | On a dev machine: `npm rebuild better-sqlite3` (or fresh `npm install`), then `npm run dev` and exercise check-in → preview-fee → check-out → revenue. |
| R2 | **Renderer never typechecked** — backend passed `npx tsc --noEmit` (main-scope); renderer reports `partially_verified` (no Node in sandbox). A3 drift + any `ApiMap` mismatch will surface here. | `npx tsc --noEmit` (full scope incl. `src/renderer`). |
| R3 | **Runtime QA still open** (carried from design QA §6): keyboard-only pass, 200% zoom, real contrast measurement, Guest 30s poll + auto-retry, receipt dialog print. | Manual pass per `./specs/design-qa-report.md` §6. |
| R4 | **Fee unit tests cover backend only** (10/10 pass) — renderer `lib/fee.ts` duplicate has no tests; A2 removes the need, but until then a drift test (backend vs renderer on same vectors) would catch divergence. | `npm run verify:fee` + add renderer-side vectors if A2 is deferred. |

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm install
npm rebuild better-sqlite3        # R1: requires VS Build Tools (or use prebuilt)
npx tsc --noEmit                  # R2: must pass on FULL scope incl. src/renderer
npm run verify:fee                # R4: 10/10 fee vectors
npm run dev                       # R1+R3: real check-in/out + staff-dashboard check (A1)
```

---

## Summary

- **Overall: `partially_verified`** — static integration + security review complete (all 4 items covered, report `verified` as a review artifact); **runtime IPC unverified** (R1) and renderer typecheck unrun (R2).
- **Top risks**: (1) **A1 High** — staff Dashboard calls admin-only revenue IPC (fail-closed, fix before delivery by routing through `reports:dashboard`); (2) **A2 Medium** — server fee preview bypassed, receipt may differ from preview; (3) **R1** — no IPC path ever executed (`npm rebuild better-sqlite3` + `npm run dev` required).
- **Security posture: PASS** — bcrypt only, hash never leaves main, guards match matrix §11 on all 25 channels, parameterized SQL, single-transaction checkout, append-only payments. No Critical findings. Rotate default seed credentials after handover.
- **Delegation suggested**: A1+A2+A3 → `@frontend-react`; security notes 3–5 → `@node-developer`; re-review after runtime verification (R1–R3).
