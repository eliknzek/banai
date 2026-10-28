"""Configurable prototype defaults.

ASSUMPTION: every value in this module is a configurable prototype default for
rendering safety and convenience, NOT an approved business or manufacturing
rule. Mirrored in frontend/src/domain/defaults.js.
"""

# (min, max) inclusive, in millimetres unless noted.
LIMITS: dict[str, tuple[int, int]] = {
    "width": (300, 6000),
    "height": (300, 3500),
    "depth": (200, 1200),
    "panelThickness": (5, 50),
    "partitionThickness": (5, 50),
    "compartmentWidth": (50, 6000),
    "shelfThickness": (5, 60),
    "drawerHeight": (50, 1000),
    "compartmentCount": (1, 20),
    "slidingDoorCount": (1, 6),
}

DEFAULT_PANEL_THICKNESS = 18
DEFAULT_SHELF_THICKNESS = 18
DEFAULT_SLIDING_DOOR_COUNT = 2


def default_appearance() -> dict:
    return {
        "material": {"catalogId": "melamine"},
        "color": {"catalogId": "white"},
        "finish": {"catalogId": "matte"},
    }


BASIC_WARDROBE_OPS: list[dict] = [
    {"op": "create_wardrobe", "width": 2000, "height": 2400, "depth": 600, "compartmentCount": 3,
     "compartmentIds": ["cmp_left", "cmp_middle", "cmp_right"], "partitionIds": ["prt_1", "prt_2"]},
    {"op": "add_shelf", "compartmentId": "cmp_left", "y": 400, "id": "shf_l1"},
    {"op": "add_shelf", "compartmentId": "cmp_left", "y": 800, "id": "shf_l2"},
    {"op": "add_shelf", "compartmentId": "cmp_left", "y": 1200, "id": "shf_l3"},
    {"op": "add_shelf", "compartmentId": "cmp_left", "y": 1600, "id": "shf_l4"},
    {"op": "add_shelf", "compartmentId": "cmp_middle", "y": 2000, "id": "shf_m1"},
    {"op": "add_rail", "compartmentId": "cmp_middle", "y": 1900, "id": "rail_m1"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 800, "id": "shf_r1"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 1400, "id": "shf_r2"},
    {"op": "add_drawer", "compartmentId": "cmp_right", "y": 0, "height": 200, "id": "drw_r1"},
    {"op": "add_drawer", "compartmentId": "cmp_right", "y": 200, "height": 200, "id": "drw_r2"},
    {"op": "configure_doors", "type": "hinged", "ids": ["dr_left", "dr_middle", "dr_right"]},
]


def basic_wardrobe() -> dict:
    """The predefined starting wardrobe (entry option 3). Built through the op protocol."""
    from app.domain.apply import apply_ops  # local import: apply depends on this module
    from app.domain.catalog import load_catalog

    return apply_ops(None, BASIC_WARDROBE_OPS, load_catalog())


# Extra starting templates, offered on the start screen next to the basic wardrobe. Example layouts
# (configurable defaults, not recommendations). Mirrors TEMPLATES in frontend/src/domain/presets.js;
# shared/fixtures/designs/<id>.json pins the result on both sides.

KIDS_WARDROBE_OPS: list[dict] = [
    {"op": "create_wardrobe", "width": 1000, "height": 1500, "depth": 500, "compartmentCount": 2,
     "compartmentIds": ["cmp_left", "cmp_right"], "partitionIds": ["prt_1"]},
    {"op": "add_rail", "compartmentId": "cmp_left", "y": 1150, "id": "rail_l1"},
    {"op": "add_shelf", "compartmentId": "cmp_left", "y": 1250, "id": "shf_l1"},
    {"op": "add_drawer", "compartmentId": "cmp_right", "y": 0, "height": 180, "id": "drw_r1"},
    {"op": "add_drawer", "compartmentId": "cmp_right", "y": 180, "height": 180, "id": "drw_r2"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 600, "id": "shf_r1"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 900, "id": "shf_r2"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 1200, "id": "shf_r3"},
    {"op": "configure_doors", "type": "hinged", "ids": ["dr_left", "dr_right"]},
    {"op": "set_material", "target": "doors", "color": {"catalogId": "olive_green"}, "finish": {"catalogId": "satin"}},
]

DOUBLE_SLIDING_WARDROBE_OPS: list[dict] = [
    {"op": "create_wardrobe", "width": 2400, "height": 2400, "depth": 650, "compartmentCount": 4,
     "compartmentIds": ["cmp_a", "cmp_b", "cmp_c", "cmp_d"], "partitionIds": ["prt_1", "prt_2", "prt_3"]},
    {"op": "add_rail", "compartmentId": "cmp_a", "y": 1900, "id": "rail_a1"},
    {"op": "add_shelf", "compartmentId": "cmp_a", "y": 2000, "id": "shf_a1"},
    {"op": "add_shelf", "compartmentId": "cmp_b", "y": 400, "id": "shf_b1"},
    {"op": "add_shelf", "compartmentId": "cmp_b", "y": 800, "id": "shf_b2"},
    {"op": "add_shelf", "compartmentId": "cmp_b", "y": 1200, "id": "shf_b3"},
    {"op": "add_shelf", "compartmentId": "cmp_b", "y": 1600, "id": "shf_b4"},
    {"op": "add_shelf", "compartmentId": "cmp_b", "y": 2000, "id": "shf_b5"},
    {"op": "add_drawer", "compartmentId": "cmp_c", "y": 0, "height": 200, "id": "drw_c1"},
    {"op": "add_drawer", "compartmentId": "cmp_c", "y": 200, "height": 200, "id": "drw_c2"},
    {"op": "add_drawer", "compartmentId": "cmp_c", "y": 400, "height": 200, "id": "drw_c3"},
    {"op": "add_shelf", "compartmentId": "cmp_c", "y": 1000, "id": "shf_c1"},
    {"op": "add_shelf", "compartmentId": "cmp_c", "y": 1500, "id": "shf_c2"},
    {"op": "add_shelf", "compartmentId": "cmp_c", "y": 2000, "id": "shf_c3"},
    {"op": "add_rail", "compartmentId": "cmp_d", "y": 1900, "id": "rail_d1"},
    {"op": "add_shelf", "compartmentId": "cmp_d", "y": 2000, "id": "shf_d1"},
    {"op": "configure_doors", "type": "sliding", "ids": ["dr_left", "dr_right"]},
    {"op": "set_material", "target": "doors", "material": {"catalogId": "oak_veneer"}, "color": {"catalogId": "natural_oak"}},
]

MINIMALIST_WARDROBE_OPS: list[dict] = [
    {"op": "create_wardrobe", "width": 1800, "height": 2200, "depth": 600, "compartmentCount": 2,
     "compartmentIds": ["cmp_left", "cmp_right"], "partitionIds": ["prt_1"]},
    {"op": "add_rail", "compartmentId": "cmp_left", "y": 1800, "id": "rail_l1"},
    {"op": "add_shelf", "compartmentId": "cmp_left", "y": 1900, "id": "shf_l1"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 500, "id": "shf_r1"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 1000, "id": "shf_r2"},
    {"op": "add_shelf", "compartmentId": "cmp_right", "y": 1500, "id": "shf_r3"},
    {"op": "configure_doors", "type": "hinged", "ids": ["dr_left", "dr_right"]},
    {"op": "set_material", "target": "carcass", "material": {"catalogId": "lacquered_mdf"}},
    {"op": "set_material", "target": "doors", "material": {"catalogId": "lacquered_mdf"}},
]

# Template id -> ops. The id names the shared fixture.
TEMPLATE_OPS: dict[str, list[dict]] = {
    "kids": KIDS_WARDROBE_OPS,
    "double_sliding": DOUBLE_SLIDING_WARDROBE_OPS,
    "minimalist": MINIMALIST_WARDROBE_OPS,
}


def template_design(template_id: str) -> dict:
    """Build a start-screen template through the op protocol (raises KeyError for unknown ids)."""
    from app.domain.apply import apply_ops  # local import: apply depends on this module
    from app.domain.catalog import load_catalog

    return apply_ops(None, TEMPLATE_OPS[template_id], load_catalog())
