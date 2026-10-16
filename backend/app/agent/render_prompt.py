"""The prompt for the photoreal render, written by the server from the validated design.

Only design data goes in (sizes, door type, layout counts, catalog names, custom colour names
that the domain schema already validated as safe visible text). No customer message or agent
text is ever part of it. The 3D capture is the reference image; the prompt pins the model to it.
"""

from __future__ import annotations

from app.agent.describe import cm


def _names(catalog: dict) -> dict:
    return {entry["id"]: entry["name"] for section in catalog.values() for entry in section}


def _appearance(appearance: dict, names: dict) -> str:
    parts = []
    for field in ("color", "material", "finish"):
        ref = appearance.get(field) or {}
        if ref.get("custom"):
            parts.append(f"custom colour \"{ref['name']}\"" + (f" ({ref['hex']})" if ref.get("hex") else ""))
        elif ref.get("catalogId"):
            parts.append(names.get(ref["catalogId"], ref["catalogId"]).lower())
    return " ".join(parts)


def _layout(design: dict) -> str:
    rows = []
    for index, compartment in enumerate(design["compartments"], start=1):
        items = [f"{len(compartment[k])} {one if len(compartment[k]) == 1 else many}" for k, one, many in
                 (("shelves", "shelf", "shelves"), ("drawers", "drawer", "drawers"), ("rails", "hanging rail", "hanging rails"))
                 if compartment[k]]
        rows.append(f"compartment {index} ({cm(compartment['width'])} wide): {', '.join(items) or 'empty'}")
    return "; ".join(rows)


def render_prompt(design: dict, catalog: dict, doors_visible: bool) -> str:
    names = _names(catalog)
    width, height, depth = (design["dimensions"][k] for k in ("width", "height", "depth"))
    doors = design["doors"]
    count = len(doors["items"])
    door_text = {"none": "no doors (open front)", "sliding": f"{count} sliding door panels",
                 "hinged": f"{count} hinged doors with handles"}[doors["type"]]
    lines = [
        "Photorealistic product photograph of exactly the wardrobe in the reference image.",
        "Keep the exact proportions, viewing angle, and the number and positions of compartments, "
        "partitions, shelves, drawers, doors and handles shown in the reference. Do not add, remove or move anything.",
        f"Overall size: {cm(width)} wide, {cm(height)} high, {cm(depth)} deep. A standard straight freestanding wardrobe.",
        f"Body and interior: {_appearance(design['carcass']['appearance'], names)}.",
    ]
    if doors["type"] != "none":
        lines.append(f"Doors: {door_text}, {_appearance(doors['appearance'], names)}.")
        lines.append("Doors are shown closed." if doors_visible else
                     "Doors are left out so the interior is visible, as in the reference.")
    else:
        lines.append(f"Doors: {door_text}.")
    lines += [
        f"Interior layout, left to right: {_layout(design)}.",
        "Realistic wood-panel and board materials with natural texture, soft even studio lighting, "
        "a clean light neutral background and floor, gentle contact shadow.",
        "No people, no text, no logos, no extra furniture or decoration.",
    ]
    return "\n".join(lines)
