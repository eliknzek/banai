# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BanAI is an MVP AI wardrobe designer for standard straight wardrobes only. Three parts stay synchronized through **one canonical design state**: a chat agent (OpenAI, structured proposals), a manual properties editor, and a Three.js 3D viewer. Designs are persisted in Supabase behind secure share links, and an AI photoreal preview is generated from the 3D view.

- The full product brief is in Obsidian: `BanAI/06 - Product Specification.md`.
- The approved architecture and phase plan is in `docs/architecture.md`. Read it before starting any phase.

## Working rules for this repo

- **Always plan before executing.** Before writing code or changing infrastructure, produce a plan (use plan mode for any non-trivial task). The plan should cover:
  - what will change
  - which files and services are affected
  - risks
  - how the result will be verified

  Get the user's approval before implementing. This applies to every phase and to any change outside a phase.
- **Test gate between phases.** Before reporting a phase as complete and moving on, run the **full test suite**:
  - **Regression:** every existing backend and frontend test, not just the new ones: `uv run pytest` and `npm test`.
  - **End-to-end:** the E2E tests for the user flows that exist so far, run with **two tools**:
    - **Playwright:** the automated, repeatable suite in `frontend/tests/e2e/`. It is committed and runs headless. Phase 3 adds the first suite, and it grows each phase toward the full acceptance scenario (spec §21).
    - **Claude in Chrome** (`mcp__claude-in-chrome__*`, after loading the `claude-in-chrome` skill): a live, visual walkthrough of the same flows in a real Chrome tab. Check rendering, 3D interaction, layout, and the browser console, and record a GIF of the key flow with `gif_creator`. Use it to catch what headless assertions miss, not as a replacement for Playwright.
  - **Do not move to the next phase unless every test passes.** Report the actual test output in the phase report. If anything fails, fix it, or report the failure and stop. Never skip or disable a test to get green.
- **Security review gate between phases.** Before moving to the next phase, run a security review of everything the phase changed. Use the **security-reviewer** agent and/or `/security-review`, covering:
  - input validation (including LLM-generated input)
  - secrets
  - authorization
  - injection
  - DoS limits
  - dependency vulnerabilities (`npm audit`)

  **Do not move to the next phase until the security review passes:** every CRITICAL and HIGH finding fixed and re-verified. Summarize the review result in the phase report.
- **Phased delivery.** Work proceeds Phase 1 → 10 (`docs/architecture.md` §10a). After each phase, stop, report (what was implemented, files changed, real test output, known issues, next step), and wait for the user's approval. Never roll into the next phase on your own.
- **Branches.** All work lands on `dev`, which Railway auto-deploys to the `dev` environment. Pushing or merging to `main` deploys **production** and needs explicit user approval.
- **Excluded features (do not build):** pricing, quotes, orders, accounts or registration, dashboards, manufacturing/CNC export, feasibility rules, room design, image uploads, mobile-first layout, drag-and-drop geometry, and any AI change applied without approval. The app must never claim a design is manufacturable.
- **Carpenter spec PDF (in scope since 2026-10-16, spec §9b, ADR-008).** After a render, the customer can download or share (device share sheet) a build spec for a carpenter:
  - parts as designed, a front drawing, materials, suggested hardware and a suggested assembly order, with the render as the illustration
  - still excluded: CNC files, a cut list (cut sizes and clearances are the carpenter's call), server-side email, and any claim of manufacturability
  - every page carries the "not a manufacturing drawing, verify before cutting" disclaimer
  - the PDF is built on the server (`backend/app/spec/`, ReportLab + python-bidi) in the interface language
- **Voice (in scope since 2026-10-16, spec §9a).** Voice is only another way to talk to the existing agent:
  - Chained pipeline: speech-to-text → the existing `/api/chat` → text-to-speech. Speech never bypasses `/api/chat`, so every change is still a validated, signed proposal.
  - Voice never applies a change: the customer still presses **Confirm**.
  - The transcript is shown in the chat, so the customer sees what was understood.
  - The browser never calls OpenAI directly: audio goes to the backend, which holds the key.
  - Architecture and open questions: Obsidian `07 - Voice Agent Architecture` (ADR-007).
- **Mandatory stack.**
  - Frontend: vanilla JS ES modules + Three.js, bundled with Vite. **No React, Vue, or R3F.**
  - Backend: FastAPI + Pydantic.
  - UI design comes from Google Stitch MCP, adapted to vanilla HTML/CSS.
- **Defaults are not business rules.** Units, default dimensions, catalog contents, and model names are configurable defaults documented in Obsidian `04 - Decisions & Assumptions`. Label them that way.

## Commands

The backend uses uv (Python 3.13). The frontend needs Node 22+.

```bash
# Backend (from backend/)
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest                                  # all tests
uv run pytest tests/test_health.py::test_health_returns_ok   # single test
uv run pytest --cov=app                        # coverage

# Frontend (from frontend/)
npm ci
npm run dev                                    # http://localhost:5173
npm test                                       # vitest run (tests/unit/**/*.test.js)
npx vitest run tests/unit/client.test.js -t "throws"   # single file / test name
npm run build                                  # vite build -> dist/
```

- Copy `.env.example` to `.env` in each service directory.
- The frontend reads the backend URL from `VITE_API_BASE_URL` at build time; it defaults to `http://localhost:8000`.
- The backend's CORS origins come from `CORS_ORIGINS`.

## Architecture (target design; implemented incrementally by phase)

- **Single operation protocol.** Every change is a list of typed, pure ops (`(design) -> newDesign`, no mutation). That covers manual edits and AI edits alike: `update_dimensions`, `configure_doors`, `add_*` / `modify_*` for compartments, partitions, shelves, drawers, and rails, `set_material`, and `remove_component`. The ops engine exists twice:
  - `backend/app/domain/`: the authoritative version, used for AI validation and saves.
  - `frontend/src/state/`: used for instant manual editing.
  - Parity between them is enforced by golden fixtures in `shared/fixtures/ops/*.json`, which both pytest and vitest run. If you change an op on one side, change the other side and the fixtures too.
- **Canonical schema.**
  - All lengths are integer **millimetres**.
  - `compartments[]` is ordered left to right. `partitions[i]` sits between compartments `i` and `i+1`.
  - Width invariant: Σ compartment widths + Σ partition thicknesses + 2 × `panelThickness` = overall width.
  - IDs are stable and carry a type prefix (`cmp_`, `prt_`, `shf_`, `drw_`, `rail_`, `dr_`).
  - `revision` and `designId` live **outside** the design object.
- **Three.js renders from state only.** The viewer never owns data. The AI never touches Three.js objects. Viewer code is split into geometry builders, rendering, and picking.
- **AI proposals are stateless and signed.**
  - `/api/chat` receives `{messages, design, revision}`. The agent is called only on user messages, never on manual edits.
  - OpenAI tool calls are parsed with Pydantic, dry-run on a copy of the design, and returned as an HMAC-signed proposal `{ops, baseRevision, baseHash}`.
  - `/api/proposals/apply` verifies the signature and returns **409** if the revision or hash is stale.
  - Pending proposals are never part of the committed state. Cancel is client-only.
- **Persistence.**
  - Only the backend talks to Supabase. The `designs` table has RLS enabled with no policies, and anon/authenticated grants are revoked.
  - Share link: `/#d=<uuid>.<token>`. The token is 256-bit, stored only as a SHA-256 hash, and compared in constant time.
  - Saves use optimistic concurrency (`UPDATE ... WHERE revision = n`).
- **API responses** use the envelope `{success, data, error}`.
- **Interface language (Hebrew by default, English optional).**
  - Every UI string lives in `frontend/src/i18n/he.js` and `en.js`. The two dictionaries must keep the same keys and placeholders, which a test enforces.
  - Hebrew is right to left (`<html dir="rtl">`). The language switch is live and is remembered in `localStorage` as `banai.locale`.
  - The server stays language-neutral:
    - Proposal-card rows carry a stable `key` plus raw `params` (mm, 1-based indexes from the left together with their `count`, catalog ids), and the client words them (`i18n/changes.js`). The English `title` and `detail` are only the fallback.
    - The single exception is the carpenter PDF, which is built on the server in the interface language (`backend/app/spec/strings.py`).
  - **Numbering:** in Hebrew, compartments, partitions and doors are numbered **from the right** (תא 1 = rightmost). Only the displayed number changes, and the data stays left to right.
    - Use `spatialNumber(i, count)` in the frontend and `Writer.num` in the PDF. Never hand-roll `index + 1` for a label.
    - The agent receives the same rule as a developer note when the locale is `he`.
  - Unit tests run in English (`tests/unit/setup/locale.js`). E2E specs default to English through the `uiLocale` fixture, and Hebrew specs use `test.use({ uiLocale: 'default' })`.
- **Photoreal render (Phase 8).**
  - `/api/render` takes the captured 3D view plus the validated design and returns an illustrative image. It never changes the design.
  - The model is `OPENAI_IMAGE_MODEL`, a configurable default.
  - After a render, the dialog offers the carpenter spec (`/api/spec`). Uploaded images are checked by magic bytes and by pixel size from the header, and are re-encoded before use.

## Infrastructure

- **Railway project `banai`.**
  - Environments: `production` deploys from `main`, `dev` deploys from `dev`.
  - Services: `backend` (root `/backend`) and `frontend` (root `/frontend`).
  - Builder is Railpack. Watch patterns limit rebuilds to the changed service.
  - Settings live in the Railway environment config, mirrored in each service's `railway.json`.
  - Variables are set per environment and never shared between them.
  - Details and IDs: `docs/railway.md`.
- **Supabase.** `banai-dev` (`lrulgstsqnxllknfvdpr`) and `banai-prod` (`lkslzvgypmbjltrtcrec`).
  - The CLI is linked to **dev**. Link prod only for an approved release.
  - DB passwords are in the gitignored root file `.env.supabase`.
  - Create migrations with `supabase migration new <name>` and push with `supabase db push`.
- **Obsidian docs** live in the vault folder `BanAI/`. A project Stop hook (`.claude/hooks/obsidian_worklog.py`) appends every agent turn to `BanAI/10 - Work Log.md` through the Obsidian Local REST API. Update the curated notes (`01 - Process Log`, `05 - Open Items`) at the end of each phase.

## Gotchas

- **Windows + Python:** read files with `encoding="utf-8"`. The default codepage is cp1255, which breaks on Hebrew or other non-ASCII text.
- **Git Bash `/tmp` paths** aren't visible to Windows Python. Use the scratchpad or a Windows path instead.
- **`frontend/package.json` overrides `compression` to 1.8.2.** `serve@14` pulls a vulnerable version. Keep the override.
- **Supabase `projects create`** can time out on the client and still create the project. List projects before retrying. It also auto-links the new project, so re-link to dev afterwards.
- **`railway logs`** needs `--service` even when you pass a deployment ID.
- **`gpt-image-2.5*` rejects `input_fidelity`.** Send it only for `gpt-image-1*` models.
- **ReportLab does not do bidi.** Hebrew lines are wrapped first and then reordered with `python-bidi`, and brackets are mirrored by hand (python-bidi doesn't). In tests, `pypdf` returns cover text in logical order but table cells in visual order, so compare those cells without spaces.
- **Images inside the PDF:** PIL only warns on huge images. Always check the pixel size from the header before decoding (see `normalize_render`).
- **Playwright downloads:** read the file with `readFileSync(await download.path())`. A stream from `createReadStream()` may not be readable yet.
