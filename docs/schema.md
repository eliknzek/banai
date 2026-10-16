# Canonical Wardrobe Schema & Operation Protocol (v1)

This is the single source of truth for a wardrobe design. The 3D viewer renders from it, the properties editor edits it through ops, the AI agent proposes ops against it, and Supabase stores it as JSONB.

| Engine | Location | Role |
|---|---|---|
| Python (authoritative) | `backend/app/domain/` | Validates AI proposals, applies approved ops, gates saves |
| JavaScript | `frontend/src/domain/` | Instant manual edits in the browser |

Both engines must behave identically. `shared/fixtures/ops/*.json` is run by both `pytest` (`tests/domain/test_parity_fixtures.py`) and `vitest` (`tests/unit/domain/parity.test.js`). **When you change a rule, change both engines and add a fixture.**

## Units and coordinates
- All lengths are **integer millimetres**. Floats are schema errors.
- **Interior width** = `width − 2·panelThickness`. **Interior height** = `height − 2·panelThickness`.
- **x** runs from the inner face of the left side panel. Compartment x-ranges are *derived* (`geometry.compartment_x_ranges`) and never stored.
- **y** runs from the top face of the bottom panel:
  - a shelf occupies `[y, y+thickness]`
  - a drawer occupies `[y, y+height]`
  - a rail is a point at `y`
- `revision` and `designId` are persistence metadata. They live **outside** the design object.

## Shape
```jsonc
{
  "schemaVersion": 1, "units": "mm",
  "dimensions": { "width": 2000, "height": 2400, "depth": 600 },
  "carcass": { "panelThickness": 18, "appearance": Appearance },
  "compartments": [            // ordered left → right, at least 1
    { "id": "cmp_…", "width": 643,
      "shelves": [{ "id": "shf_…", "y": 400, "thickness": 18, "appearance": Appearance|null }],
      "drawers": [{ "id": "drw_…", "y": 0, "height": 200, "appearance": Appearance|null }],
      "rails":   [{ "id": "rail_…", "y": 1900 }] }
  ],
  "partitions": [{ "id": "prt_…", "thickness": 18 }],   // partitions[i] sits between compartments i and i+1
  "doors": { "type": "hinged|sliding|none", "appearance": Appearance,
             "items": [{ "id": "dr_…", "compartmentIds": ["cmp_…"], "hingeSide": "left|right|null", "appearance": Appearance|null }] }
}
```
**Appearance** is `{ material: Ref, color: Ref, finish: Ref }`, where each Ref is one of:
- `{ "catalogId": "white" }`: a predefined value from `backend/app/domain/catalog.json`
- `{ "custom": true, "name": "Sage green", "hex": "#9caf88" | null }`: a customer-defined value, always distinguishable from catalog values

An item override of `null` means the item inherits:
- shelves and drawers inherit from `carcass.appearance`
- doors inherit from `doors.appearance`
- rails and partitions have no appearance of their own

**IDs** are stable and typed (`cmp_`, `prt_`, `shf_`, `drw_`, `rail_`, `dr_` + 1–40 `[A-Za-z0-9_-]`), and unique within a design. Generated ids are `<prefix>_<8 hex>`.

## Validation rules
Issues are reported in this fixed order. The order is part of the parity contract.

| # | Rule | Code / path |
|---|---|---|
| 1 | Structural shape (types, unknown fields, id prefixes, at least 1 compartment) | `SCHEMA_INVALID` |
| 2 | Ids are unique | `DUPLICATE_ID` at the second occurrence |
| 3 | `len(partitions) == len(compartments) − 1` | `WIDTH_MISMATCH` at `partitions` |
| 4 | Values fall within the rendering-safety ranges in `defaults.LIMITS`, including compartment count (path `compartments`) and sliding-door count (path `doors.items`) | `OUT_OF_RANGE` |
| 5 | Σ compartment widths + Σ partition thicknesses = interior width | `WIDTH_MISMATCH` at `compartments` |
| 6 | Items lie within `[0, interiorHeight]` | `OUT_OF_BOUNDS` |
| 6 | Shelf and drawer spans don't overlap (touching is allowed); a rail is not strictly inside a span | `OVERLAP` |
| 7 | Doors (see below) | `DOOR_INVALID` |
| 8 | Every `catalogId` exists in the catalog. Skipped when no catalog is given. | `UNKNOWN_CATALOG_ID` |

Door rules:
- **hinged:** at least one door. Each door has a hinge side and covers ≥1 existing compartment. Those compartments are adjacent and ordered left → right, and no compartment is covered twice. Uncovered compartments are allowed.
- **sliding:** 1–6 panels (`LIMITS.slidingDoorCount`), with no `compartmentIds` and no hinge side.
- **none:** no items.

These are data and rendering-safety checks. **They are not manufacturing or feasibility rules.** The app never claims a design is manufacturable.

## Operations
`apply_ops(design | None, ops, catalog) → new design` (Python) and `applyOps(…)` (JS).

- **Pure.** The input is never mutated. Each op works on a private deep copy.
- **Fully re-validated** after every op. The caller never receives an invalid design.
- **Atomic.** The whole batch is schema-checked first (`ops` must be an array of ≤ 100 ops). Then the first failing op raises `DomainError {code, path, message}`, and nothing is returned.
- **Explicit ids.** Add ops accept an optional `id`. When omitted, a random id is generated. AI proposals are dry-run and applied inside `ids.seeded_ids(proposalId)`, which derives omitted ids from the proposal id, so the approved apply produces exactly the ids of the dry-run.
- **Integer arithmetic** on both sides, using floor division.

| Op | Fields | Semantics |
|---|---|---|
| `create_wardrobe` | width, height, depth, compartmentCount, panelThickness?, partitionThickness?, compartmentIds?, partitionIds? | Range-checks the dimensions first (`ops[i].width`, …). Replaces the design. Compartments get equal widths, and the integer remainder goes to the leftmost ones. Doors start as `none`, with the default appearance. |
| `update_dimensions` | width?, height?, depth? | Each given value is range-checked at op level first. A width change rescales compartments proportionally (floor, remainder to the last). If a height change would leave an item out of bounds, the op is **rejected**. Nothing is deleted silently. |
| `configure_doors` | type, doors? (hinged), count? (sliding, default 2), ids? | Hinged without a list creates one door per compartment, with hinges alternating left/right. A hinged `doors: []` → `INVALID_OP` (use `none`). Sliding without `count` uses `len(ids)`, or 2. Fields that don't apply to the type → `INVALID_OP`. |
| `add_compartment` | position (0..n), width, id?, partitionId?, partitionThickness? | Takes `width + partition` from the compartment currently at `position` (the last one when appending). A hinged door spanning the insertion point extends to cover the new compartment. |
| `modify_compartment` | compartmentId, width | The right neighbour absorbs the difference (the left one for the last compartment). Not allowed with a single compartment. |
| `add_partition` | compartmentId, offset, id?, newCompartmentId?, thickness? | Splits the compartment at `offset`. Items stay on the left, and the new right part is empty. Hinged doors covering it extend to the new part. |
| `modify_partition` | partitionId, position?, thickness? | Thickness is taken from the right neighbour, then the partition moves to the interior x `position`. Only the two neighbours change. |
| `add_shelf` / `modify_shelf` | compartmentId, y, thickness? (default 18), id? / id, y?, thickness? | |
| `add_drawer` / `modify_drawer` | compartmentId, y, height, id? / id, y?, height? | |
| `add_rail` / `modify_rail` | compartmentId, y, id? / id, y | |
| `set_material` | target (`carcass`, `doors`, or a door/shelf/drawer id), material?, color?, finish?, clear? | Partial appearance update. An item override starts from the inherited appearance. `clear` removes an override. Covers both "change material" and "change color". |
| `remove_component` | id | See the removal rules below. |

`remove_component` removal rules:
- **Shelf, drawer, rail:** removed.
- **Compartment:** a neighbour absorbs its width plus one partition (the right neighbour, or the left one for the last compartment). Its door references are dropped, along with any hinged door left empty.
- **Partition:** the right compartment merges into the left one and the item lists are unioned. If the items overlap, the op is rejected with `OVERLAP`. Doors covering the merged compartment merge into the first such door.
- **Door:** removed. When no doors remain, the type becomes `none`.
- **The last compartment:** cannot be removed (`INVALID_OP`).

Op-level error paths use `ops[i]` or `ops[i].<field>`. Issues found while validating the resulting design use design paths, for example `compartments[0].shelves[1].y`.

## Input hardening (inputs may come from an LLM)
- Every int is bounded to ±1,000,000, outside that range → `SCHEMA_INVALID`. Whole-number floats such as `1000.0` are accepted as ints, because JS cannot tell them apart.
- Keys are camelCase only. Unknown keys → `SCHEMA_INVALID`, reported at the key itself.
- `custom` must be the boolean `true`, and `schemaVersion` the integer `1`, so `1 == true` confusion is rejected.
- A Ref is tagged by the presence of `custom` on both sides, so errors come from the same branch.
- Every id in an op is pattern-checked for its type. An empty or mismatched id is a schema error and is never silently replaced. `target` is `carcass`, `doors` or a typed id.
- Optional op fields accept explicit `null`, meaning absent.
- `catalogId` must match `^[a-z0-9_]{1,40}$`.
- Custom `name` must be visible text: no control characters, zero-width characters, line or paragraph separators, bidi overrides, BOM, Unicode tag characters, or lone surrogates, and it can't be whitespace-only. Hebrew and other scripts are accepted.
- Structural caps bound the worst-case CPU of one request (about 0.25 s in Python):
  - ≤ 20 compartments
  - ≤ 20 doors
  - ≤ 100 items of one kind per compartment
  - ≤ 300 interior items per design
  - ≤ 100 ops per batch
- Error messages are engine-owned constants and never echo input. An unknown key appears in an error path only if it is a plain identifier (`^[A-Za-z][A-Za-z0-9_]{0,39}$`); otherwise the error is reported at the parent path.

## Defaults (configurable prototype values, not business rules)
These live in `defaults.py` / `defaults.js` and are mirrored on both sides:
- the `LIMITS` ranges
- panel and shelf thickness of 18 mm
- 2 sliding doors by default
- the default appearance (melamine, white, matte)
- the basic wardrobe (`shared/fixtures/designs/basic.json`): 2000×2400×600 with 3 compartments and hinged doors

The catalog contents (`catalog.json`) are placeholder prototype data.

## Proposal card rows (agent, `backend/app/agent/describe.py`)
- Every card row is written by the server from the validated ops, never by the model.
- After any change to compartment widths, a **Compartments** row lists every resulting width in cm, for example `64.3 · 64.3 · 14.3 · 48.1 cm`. The model is told not to state calculated sizes itself.
- A new or resized compartment narrower than `NARROW_COMPARTMENT_MM` (300 mm) gets a **Narrow compartment** row with `level: "warning"`, highlighted on the card. This is a configurable default for visibility, not a manufacturing or feasibility rule.
