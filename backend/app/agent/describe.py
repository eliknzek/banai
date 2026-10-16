"""Deterministic, human-readable change lines for a proposal card.

The card lists what the ops will do, written by the server from the validated ops, never
by the model. Lengths are shown in cm with one decimal (the UI unit); the data stays in mm.
"""

from __future__ import annotations

from app.domain import ops as o
from app.domain.lookup import locate

KIND_LABELS = {
    "compartment": "Compartment", "partition": "Partition", "shelves": "Shelf",
    "drawers": "Drawer", "rails": "Hanging rail", "door": "Door",
}


def cm(mm: int) -> str:
    return f"{mm / 10:.1f} cm"


def describe_ops(ops: list, base: dict, result: dict, catalog: dict) -> list[dict]:
    names = {entry["id"]: entry["name"] for section in catalog.values() for entry in section}
    return [_change(op, base, result, names) for op in ops]


def _row(title: str, detail: str) -> dict:
    return {"title": title, "detail": detail}


def _compartment_label(compartment_id: str, base: dict, result: dict) -> str:
    for design in (base, result):
        for index, compartment in enumerate(design["compartments"]):
            if compartment["id"] == compartment_id:
                return f"Compartment {index + 1}"
    return "New compartment"


def _component_label(component_id: str, base: dict, result: dict) -> str:
    found = locate(base, component_id) or locate(result, component_id)
    if not found:
        return "Component"
    kind, index, _ = found
    label = KIND_LABELS.get(kind, "Component")
    if kind in ("shelves", "drawers", "rails"):
        return f"{label} in compartment {index + 1}"
    return f"{label} {index + 1}"


def _change(op, base: dict, result: dict, names: dict) -> dict:
    match op:
        case o.CreateWardrobe():
            return _row("New wardrobe", f"{cm(op.width)} × {cm(op.height)} × {cm(op.depth)}, "
                        f"{op.compartment_count} compartments")
        case o.UpdateDimensions():
            parts = [f"{label} {cm(value)}" for label, value in
                     (("Width", op.width), ("Height", op.height), ("Depth", op.depth)) if value is not None]
            return _row("Dimensions", " · ".join(parts) or "unchanged")
        case o.ConfigureDoors():
            count = len(result["doors"]["items"])
            detail = {"none": "No doors", "sliding": f"Sliding, {count} panels",
                      "hinged": f"Hinged, {count} doors"}[op.type]
            return _row("Doors", detail)
        case o.AddCompartment():
            return _row("Compartment added", f"Position {op.position + 1}, width {cm(op.width)}")
        case o.ModifyCompartment():
            return _row(_compartment_label(op.compartment_id, base, result), f"Width {cm(op.width)}")
        case o.AddPartition():
            return _row("Partition added", f"{_compartment_label(op.compartment_id, base, result)}, "
                        f"{cm(op.offset)} from its left edge")
        case o.ModifyPartition():
            parts = [p for p in (op.position is not None and f"position {cm(op.position)}",
                                 op.thickness is not None and f"thickness {cm(op.thickness)}") if p]
            return _row(_component_label(op.partition_id, base, result), ", ".join(parts) or "unchanged")
        case o.AddShelf():
            return _row("Shelf added", f"{_compartment_label(op.compartment_id, base, result)}, at {cm(op.y)}")
        case o.AddDrawer():
            return _row("Drawer added", f"{_compartment_label(op.compartment_id, base, result)}, "
                        f"at {cm(op.y)}, height {cm(op.height)}")
        case o.AddRail():
            return _row("Hanging rail added", f"{_compartment_label(op.compartment_id, base, result)}, "
                        f"at {cm(op.y)}")
        case o.ModifyShelf() | o.ModifyDrawer() | o.ModifyRail():
            parts = [f"{label} {cm(value)}" for label, value in
                     (("at", getattr(op, "y", None)), ("height", getattr(op, "height", None)),
                      ("thickness", getattr(op, "thickness", None))) if value is not None]
            return _row(_component_label(op.id, base, result), ", ".join(parts) or "unchanged")
        case o.SetMaterial():
            target = {"carcass": "Carcass & interior", "doors": "All doors"}.get(op.target) \
                or _component_label(op.target, base, result)
            if op.clear:
                return _row(target, "Use the inherited finish")
            parts = [_ref_name(ref, names) for ref in (op.material, op.color, op.finish) if ref is not None]
            return _row(target, ", ".join(parts))
        case o.RemoveComponent():
            return _row("Removed", _component_label(op.id, base, result))
    return _row("Change", op.op)


def _ref_name(ref, names: dict) -> str:
    catalog_id = getattr(ref, "catalog_id", None)
    if catalog_id is not None:
        return names.get(catalog_id, catalog_id)
    return ref.name  # custom names are already validated as safe visible text
