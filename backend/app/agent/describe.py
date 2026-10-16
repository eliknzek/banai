"""Deterministic, human-readable change lines for a proposal card.

The card lists what the ops will do, written by the server from the validated ops, never
by the model. Each row carries:
- `key` and `params`: language-neutral data (lengths in mm, 1-based indexes, catalog ids)
  that the client renders in the interface language (frontend/src/i18n/changes.js);
- `title` and `detail`: the same row in English, used as the fallback.
"""

from __future__ import annotations

from app.domain import ops as o
from app.domain.lookup import locate

KIND = {"compartment": "compartment", "partition": "partition", "shelves": "shelf",
        "drawers": "drawer", "rails": "rail", "door": "door"}
KIND_LABELS = {"compartment": "Compartment", "partition": "Partition", "shelf": "Shelf",
               "drawer": "Drawer", "rail": "Hanging rail", "door": "Door"}

# A compartment narrower than this is flagged on the card. Configurable default, not a
# business or manufacturing rule (Obsidian 04 - Decisions & Assumptions).
NARROW_COMPARTMENT_MM = 300


def cm(mm: int) -> str:
    return f"{mm / 10:.1f} cm"


def describe_ops(ops: list, base: dict, result: dict, catalog: dict) -> list[dict]:
    names = {entry["id"]: entry["name"] for section in catalog.values() for entry in section}
    return [_change(op, base, result, names) for op in ops] + _layout_rows(base, result)


def _row(key: str, params: dict, title: str, detail: str, **extra) -> dict:
    return {"key": key, "params": params, "title": title, "detail": detail, **extra}


def _layout_rows(base: dict, result: dict) -> list[dict]:
    """Server-computed truth for structural changes: every resulting compartment width, plus a
    warning for any new or resized compartment that ends up narrow. The model never does this
    arithmetic for the customer."""
    before = {c["id"]: c["width"] for c in base["compartments"]}
    after = [(c["id"], c["width"]) for c in result["compartments"]]
    if [w for _, w in after] == [c["width"] for c in base["compartments"]]:
        return []
    widths = [w for _, w in after]
    rows = [_row("compartments", {"widths": widths}, "Compartments", " · ".join(f"{w / 10:.1f}" for w in widths) + " cm")]
    for index, (cid, width) in enumerate(after):
        if width < NARROW_COMPARTMENT_MM and before.get(cid) != width:
            rows.append(_row("narrow", {"index": index + 1, "width": width}, "Narrow compartment",
                             f"Compartment {index + 1}: {cm(width)}", level="warning"))
    return rows


def _compartment_ref(compartment_id: str, base: dict, result: dict) -> dict:
    for design in (base, result):
        for index, compartment in enumerate(design["compartments"]):
            if compartment["id"] == compartment_id:
                return {"kind": "compartment", "index": index + 1}
    return {"kind": "compartment", "index": None}


def _component_ref(component_id: str, base: dict, result: dict) -> dict:
    found = locate(base, component_id) or locate(result, component_id)
    if not found:
        return {"kind": "component"}
    kind, index, _ = found
    kind = KIND.get(kind, "component")
    if kind in ("shelf", "drawer", "rail"):
        return {"kind": kind, "compartment": index + 1}
    return {"kind": kind, "index": index + 1}


def ref_text(ref: dict) -> str:
    """English label of a component reference."""
    kind = ref["kind"]
    if kind == "compartment" and ref.get("index") is None:
        return "New compartment"
    if kind in ("shelf", "drawer", "rail"):
        return f"{KIND_LABELS[kind]} in compartment {ref['compartment']}"
    if kind in KIND_LABELS:
        return f"{KIND_LABELS[kind]} {ref['index']}"
    return "Component"


def _sizes(pairs) -> tuple[dict, list[str]]:
    params = {name: value for name, _, value in pairs if value is not None}
    return params, [f"{label} {cm(value)}" for _, label, value in pairs if value is not None]


def _change(op, base: dict, result: dict, names: dict) -> dict:
    match op:
        case o.CreateWardrobe():
            params = {"width": op.width, "height": op.height, "depth": op.depth, "count": op.compartment_count}
            return _row("create", params, "New wardrobe",
                        f"{cm(op.width)} × {cm(op.height)} × {cm(op.depth)}, {op.compartment_count} compartments")
        case o.UpdateDimensions():
            params, parts = _sizes([("width", "Width", op.width), ("height", "Height", op.height), ("depth", "Depth", op.depth)])
            return _row("dimensions", params, "Dimensions", " · ".join(parts) or "unchanged")
        case o.ConfigureDoors():
            count = len(result["doors"]["items"])
            detail = {"none": "No doors", "sliding": f"Sliding, {count} panels", "hinged": f"Hinged, {count} doors"}[op.type]
            return _row("doors", {"type": op.type, "count": count}, "Doors", detail)
        case o.AddCompartment():
            return _row("compartmentAdded", {"position": op.position + 1, "width": op.width}, "Compartment added",
                        f"Position {op.position + 1}, width {cm(op.width)}")
        case o.ModifyCompartment():
            ref = _compartment_ref(op.compartment_id, base, result)
            return _row("compartmentWidth", {"ref": ref, "width": op.width}, ref_text(ref), f"Width {cm(op.width)}")
        case o.AddPartition():
            ref = _compartment_ref(op.compartment_id, base, result)
            return _row("partitionAdded", {"ref": ref, "offset": op.offset}, "Partition added",
                        f"{ref_text(ref)}, {cm(op.offset)} from its left edge")
        case o.ModifyPartition():
            ref = _component_ref(op.partition_id, base, result)
            params, parts = _sizes([("position", "position", op.position), ("thickness", "thickness", op.thickness)])
            return _row("partition", {"ref": ref, **params}, ref_text(ref), ", ".join(parts) or "unchanged")
        case o.AddShelf():
            ref = _compartment_ref(op.compartment_id, base, result)
            return _row("shelfAdded", {"ref": ref, "y": op.y}, "Shelf added", f"{ref_text(ref)}, at {cm(op.y)}")
        case o.AddDrawer():
            ref = _compartment_ref(op.compartment_id, base, result)
            return _row("drawerAdded", {"ref": ref, "y": op.y, "height": op.height}, "Drawer added",
                        f"{ref_text(ref)}, at {cm(op.y)}, height {cm(op.height)}")
        case o.AddRail():
            ref = _compartment_ref(op.compartment_id, base, result)
            return _row("railAdded", {"ref": ref, "y": op.y}, "Hanging rail added", f"{ref_text(ref)}, at {cm(op.y)}")
        case o.ModifyShelf() | o.ModifyDrawer() | o.ModifyRail():
            ref = _component_ref(op.id, base, result)
            params, parts = _sizes([("y", "at", getattr(op, "y", None)), ("height", "height", getattr(op, "height", None)),
                                    ("thickness", "thickness", getattr(op, "thickness", None))])
            return _row("item", {"ref": ref, **params}, ref_text(ref), ", ".join(parts) or "unchanged")
        case o.SetMaterial():
            target = {"kind": op.target} if op.target in ("carcass", "doors") else _component_ref(op.target, base, result)
            title = {"carcass": "Carcass & interior", "doors": "All doors"}.get(op.target) or ref_text(target)
            if op.clear:
                return _row("materialCleared", {"target": target}, title, "Use the inherited finish")
            refs = [(field, ref) for field, ref in (("material", op.material), ("color", op.color), ("finish", op.finish)) if ref is not None]
            values = [_ref_value(field, ref) for field, ref in refs]
            return _row("material", {"target": target, "values": values}, title, ", ".join(_ref_name(ref, names) for _, ref in refs))
        case o.RemoveComponent():
            ref = _component_ref(op.id, base, result)
            return _row("removed", {"ref": ref}, "Removed", ref_text(ref))
    return _row("change", {"op": op.op}, "Change", op.op)


def _ref_value(field: str, ref) -> dict:
    catalog_id = getattr(ref, "catalog_id", None)
    if catalog_id is not None:
        return {"field": field, "catalogId": catalog_id}
    return {"field": field, "custom": ref.name}  # custom names are validated as safe visible text


def _ref_name(ref, names: dict) -> str:
    catalog_id = getattr(ref, "catalog_id", None)
    if catalog_id is not None:
        return names.get(catalog_id, catalog_id)
    return ref.name
