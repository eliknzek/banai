"""The parts of a wardrobe as the 3D model builds them, for the carpenter spec.

These are the sizes of the designed parts, not cut sizes: clearances, edge banding, grooves and
final hardware are the carpenter's call. The rules mirror the viewer's builders
(frontend/src/viewer/builders/*.js) and their VISUAL constants (frontend/src/viewer/units.js);
if the model changes there, change it here too (tests pin the shared numbers).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.geometry import compartment_x_ranges, interior_height, interior_width

# Mirrors VISUAL in frontend/src/viewer/units.js (model values, not manufacturing rules).
BACK_THICKNESS = 6
DOOR_THICKNESS = 18
DOOR_GAP = 2
DRAWER_GAP = 3
SLIDING_OVERLAP = 60

# Suggested hardware (configurable defaults, labelled "to be confirmed by the carpenter").
HINGES_BY_DOOR_HEIGHT = ((1000, 2), (1800, 3))  # up to height -> count; above the last -> 4
HINGES_ABOVE = 4
SHELF_SUPPORTS = 4
RAIL_BRACKETS = 2


@dataclass(frozen=True)
class Part:
    key: str                     # e.g. "side", "shelf" (worded per language in strings.py)
    qty: int
    size: tuple[int, int, int]   # width, height, thickness/depth in mm
    finish: str                  # "carcass" | "doors" | an item id with its own finish
    note: dict = field(default_factory=dict)  # e.g. {"compartment": 2, "y": 1000}


@dataclass(frozen=True)
class Spec:
    width: int
    height: int
    depth: int
    panel: int
    parts: list[Part]
    hardware: list[tuple[str, int]]   # (key, count)
    door_type: str
    compartments: list[dict]          # per compartment: index, width, x0, shelves, drawers, rails


def hinges_for(height: int) -> int:
    for limit, count in HINGES_BY_DOOR_HEIGHT:
        if height <= limit:
            return count
    return HINGES_ABOVE


def derive(design: dict) -> Spec:
    width, height, depth = (design["dimensions"][k] for k in ("width", "height", "depth"))
    panel = design["carcass"]["panelThickness"]
    inner_w, inner_h = interior_width(design), interior_height(design)
    inner_depth = depth - BACK_THICKNESS
    ranges = compartment_x_ranges(design)
    parts = [
        Part("side", 2, (depth, height, panel), "carcass"),
        Part("topBottom", 2, (inner_w, depth, panel), "carcass"),
        Part("back", 1, (inner_w, height - 2 * panel, BACK_THICKNESS), "carcass"),
    ]
    for partition in design["partitions"]:
        parts.append(Part("partition", 1, (inner_depth, inner_h, partition["thickness"]), "carcass"))

    hardware: dict[str, int] = {}
    add = lambda key, n: hardware.__setitem__(key, hardware.get(key, 0) + n)  # noqa: E731
    compartments = []
    for index, (compartment, (x0, x1)) in enumerate(zip(design["compartments"], ranges), start=1):
        cw = compartment["width"]
        for shelf in compartment["shelves"]:
            parts.append(Part("shelf", 1, (cw, inner_depth, shelf["thickness"]),
                              shelf["id"] if shelf.get("appearance") else "carcass", {"compartment": index, "y": shelf["y"]}))
            add("shelfSupports", SHELF_SUPPORTS)
        for drawer in compartment["drawers"]:
            parts.append(Part("drawerFront", 1, (cw - 2 * DRAWER_GAP, drawer["height"] - 2 * DRAWER_GAP, DOOR_THICKNESS),
                              drawer["id"] if drawer.get("appearance") else "carcass", {"compartment": index, "y": drawer["y"]}))
            add("drawerRunners", 1)
            add("handles", 1)
        for rail in compartment["rails"]:
            parts.append(Part("rail", 1, (cw, 0, 0), "hardware", {"compartment": index, "y": rail["y"]}))
            add("railBrackets", RAIL_BRACKETS)
        compartments.append({
            "index": index, "width": cw, "x0": x0, "x1": x1,
            "shelves": sorted(s["y"] for s in compartment["shelves"]),
            "drawers": sorted((d["y"], d["height"]) for d in compartment["drawers"]),
            "rails": sorted(r["y"] for r in compartment["rails"]),
        })

    doors = design["doors"]
    door_h = inner_h - 2 * DOOR_GAP
    if doors["type"] == "hinged":
        by_id = {c["id"]: i for i, c in enumerate(design["compartments"])}
        for door in doors["items"]:
            first, last = by_id[door["compartmentIds"][0]], by_id[door["compartmentIds"][-1]]
            door_w = ranges[last][1] - ranges[first][0] - 2 * DOOR_GAP
            parts.append(Part("hingedDoor", 1, (door_w, door_h, DOOR_THICKNESS), door["id"] if door.get("appearance") else "doors",
                              {"hinge": door["hingeSide"], "compartments": [first + 1, last + 1]}))
            add("hinges", hinges_for(door_h))
            add("handles", 1)
    elif doors["type"] == "sliding":
        count = len(doors["items"])
        overlap = SLIDING_OVERLAP if count > 1 else 0
        panel_w = round((inner_w + (count - 1) * overlap) / count)
        parts.append(Part("slidingPanel", count, (panel_w, door_h, DOOR_THICKNESS), "doors", {"overlap": overlap}))
        add("slidingTrack", 1)
        add("handles", count)

    order = ["hinges", "slidingTrack", "drawerRunners", "railBrackets", "shelfSupports", "handles"]
    return Spec(width, height, depth, panel, parts, [(k, hardware[k]) for k in order if k in hardware],
                doors["type"], compartments)
