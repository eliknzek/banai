import copy
import json

import pytest

from app.domain.defaults import LIMITS, TEMPLATE_OPS, basic_wardrobe, template_design
from app.domain.errors import DomainError
from app.domain.schema import parse_design
from app.domain.validation import validate_design

from .conftest import load_design


def codes(errors):
    return [(e.code, e.path) for e in errors]


def test_fixture_design_is_valid(two, catalog):
    assert validate_design(two, catalog) == []


def test_round_trip_is_lossless(two):
    dumped = parse_design(two)
    assert dumped == two
    assert json.loads(json.dumps(dumped)) == two


def test_basic_wardrobe_matches_shared_fixture_and_is_valid(catalog):
    design = basic_wardrobe()
    assert design == load_design("basic")
    assert validate_design(design, catalog) == []


def test_template_ids_match_the_frontend():
    assert list(TEMPLATE_OPS) == ["kids", "double_sliding", "minimalist"]


@pytest.mark.parametrize("template_id", list(TEMPLATE_OPS))
def test_template_matches_shared_fixture_and_is_valid(template_id, catalog):
    design = template_design(template_id)
    assert design == load_design(template_id)
    assert validate_design(design, catalog) == []
    # Width invariant: compartments + partitions + both side panels = overall width.
    inner = sum(c["width"] for c in design["compartments"]) + sum(p["thickness"] for p in design["partitions"])
    assert inner + 2 * design["carcass"]["panelThickness"] == design["dimensions"]["width"]


def test_unknown_template_raises():
    with pytest.raises(KeyError):
        template_design("castle")


def test_unknown_field_is_schema_error(two):
    bad = {**two, "price": 100}
    with pytest.raises(DomainError) as info:
        parse_design(bad)
    assert info.value.code == "SCHEMA_INVALID"


def test_float_dimension_is_schema_error(two):
    bad = copy.deepcopy(two)
    bad["dimensions"]["width"] = 1000.5
    with pytest.raises(DomainError) as info:
        parse_design(bad)
    assert info.value.code == "SCHEMA_INVALID"
    assert info.value.path == "dimensions.width"


def test_wrong_id_prefix_is_schema_error(two):
    bad = copy.deepcopy(two)
    bad["compartments"][0]["shelves"][0]["id"] = "cmp_x"
    errors = validate_design(bad, None)
    assert errors[0].code == "SCHEMA_INVALID"


def test_width_mismatch(two, catalog):
    bad = copy.deepcopy(two)
    bad["compartments"][0]["width"] = 400
    assert codes(validate_design(bad, catalog)) == [("WIDTH_MISMATCH", "compartments")]


def test_partition_count_mismatch(two, catalog):
    bad = copy.deepcopy(two)
    bad["partitions"] = []
    assert ("WIDTH_MISMATCH", "partitions") in codes(validate_design(bad, catalog))


def test_dimension_out_of_range(two, catalog):
    bad = copy.deepcopy(two)
    bad["dimensions"]["depth"] = LIMITS["depth"][1] + 1
    assert ("OUT_OF_RANGE", "dimensions.depth") in codes(validate_design(bad, catalog))


def test_hinged_door_without_hinge_side(two, catalog):
    bad = copy.deepcopy(two)
    bad["doors"]["items"][0]["hingeSide"] = None
    assert ("DOOR_INVALID", "doors.items[0].hingeSide") in codes(validate_design(bad, catalog))


def test_hinged_door_non_contiguous(catalog):
    design = basic_wardrobe()
    design["doors"]["items"] = [
        {"id": "dr_1", "compartmentIds": ["cmp_left", "cmp_right"], "hingeSide": "left", "appearance": None}
    ]
    assert ("DOOR_INVALID", "doors.items[0].compartmentIds") in codes(validate_design(design, catalog))


def test_hinged_door_unknown_compartment(two, catalog):
    bad = copy.deepcopy(two)
    bad["doors"]["items"][0]["compartmentIds"] = ["cmp_nope"]
    assert ("DOOR_INVALID", "doors.items[0].compartmentIds") in codes(validate_design(bad, catalog))


def test_sliding_door_with_compartments_is_invalid(two, catalog):
    bad = copy.deepcopy(two)
    bad["doors"]["type"] = "sliding"
    bad["doors"]["items"][1]["hingeSide"] = None
    bad["doors"]["items"][0]["hingeSide"] = None
    assert ("DOOR_INVALID", "doors.items[0].compartmentIds") in codes(validate_design(bad, catalog))


def test_none_doors_with_items_is_invalid(two, catalog):
    bad = copy.deepcopy(two)
    bad["doors"]["type"] = "none"
    assert ("DOOR_INVALID", "doors.items") in codes(validate_design(bad, catalog))


def test_catalog_check_skipped_without_catalog(two):
    bad = copy.deepcopy(two)
    bad["carcass"]["appearance"]["color"] = {"catalogId": "pink"}
    assert validate_design(bad, None) == []


def test_all_errors_are_reported_in_order(two, catalog):
    bad = copy.deepcopy(two)
    bad["dimensions"]["depth"] = 10
    bad["compartments"][0]["shelves"][0]["y"] = -5
    found = codes(validate_design(bad, catalog))
    assert found.index(("OUT_OF_RANGE", "dimensions.depth")) < found.index(
        ("OUT_OF_BOUNDS", "compartments[0].shelves[0].y")
    )


def test_domain_error_to_dict():
    error = DomainError("NOT_FOUND", "ops[0].id", "missing")
    assert error.to_dict() == {"code": "NOT_FOUND", "path": "ops[0].id", "message": "missing"}


def test_catalog_entries_are_safe_text():
    """L2 (Phase 4 review): catalog names obey the same safe-text rules as custom names."""
    from app.domain.catalog import load_catalog
    from app.domain.schema import CustomRef

    for section in load_catalog().values():
        for entry in section:
            CustomRef.model_validate({"custom": True, "name": entry["name"]})
