from types import SimpleNamespace

import httpx2 as httpx
import openai
import pytest

from app.agent.describe import describe_ops
from app.agent.llm import AgentUnavailable, OpenAIClient, ToolCall, parse_arguments
from app.domain import ids
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.defaults import basic_wardrobe
from app.domain.ops import parse_ops

CHANGE_CASES = [
    ({"op": "create_wardrobe", "width": 1800, "height": 2200, "depth": 600, "compartmentCount": 2},
     ("New wardrobe", "180.0 cm × 220.0 cm × 60.0 cm, 2 compartments")),
    ({"op": "update_dimensions", "height": 2300, "depth": 550}, ("Dimensions", "Height 230.0 cm · Depth 55.0 cm")),
    ({"op": "configure_doors", "type": "hinged"}, ("Doors", "Hinged, 3 doors")),
    ({"op": "configure_doors", "type": "none"}, ("Doors", "No doors")),
    ({"op": "add_compartment", "position": 3, "width": 300}, ("Compartment added", "Position 4, width 30.0 cm")),
    ({"op": "modify_compartment", "compartmentId": "cmp_middle", "width": 700}, ("Compartment 2", "Width 70.0 cm")),
    ({"op": "add_partition", "compartmentId": "cmp_left", "offset": 300},
     ("Partition added", "Compartment 1, 30.0 cm from its left edge")),
    ({"op": "add_drawer", "compartmentId": "cmp_middle", "y": 0, "height": 200},
     ("Drawer added", "Compartment 2, at 0.0 cm, height 20.0 cm")),
    ({"op": "add_rail", "compartmentId": "cmp_left", "y": 1000}, ("Hanging rail added", "Compartment 1, at 100.0 cm")),
    ({"op": "set_material", "target": "doors", "color": {"catalogId": "walnut"}, "finish": {"catalogId": "satin"}},
     ("All doors", "Walnut, Satin")),
    ({"op": "set_material", "target": "carcass", "color": {"custom": True, "name": "Sage", "hex": "#9caf88"}},
     ("Carcass & interior", "Sage")),
    ({"op": "remove_component", "id": "cmp_right"}, ("Removed", "Compartment 3")),
]


@pytest.mark.parametrize("raw,expected", CHANGE_CASES)
def test_each_op_kind_gets_a_readable_change_line(raw, expected):
    catalog = load_catalog()
    base = apply_ops(basic_wardrobe(), [], catalog)
    parsed = parse_ops([raw])
    with ids.seeded_ids("prop_0000000000000000"):
        result = apply_ops(base, [raw], catalog)
    change, *layout = describe_ops(parsed, base, result, catalog)
    assert (change["title"], change["detail"]) == expected
    assert all(row["title"] in ("Compartments", "Narrow compartment") for row in layout)


def _changes(raw):
    catalog = load_catalog()
    base = apply_ops(basic_wardrobe(), [], catalog)
    with ids.seeded_ids("prop_0000000000000000"):
        result = apply_ops(base, raw, catalog)
    return describe_ops(parse_ops(raw), base, result, catalog)


def test_structural_changes_list_every_resulting_width():
    rows = _changes([{"op": "update_dimensions", "width": 2400}])
    assert rows[-1] == {"key": "compartments", "params": {"widths": [776, 776, 776]},
                        "title": "Compartments", "detail": "77.6 · 77.6 · 77.6 cm"}


def test_non_structural_changes_have_no_layout_rows():
    assert [r["title"] for r in _changes([{"op": "update_dimensions", "height": 2300}])] == ["Dimensions"]
    assert [r["title"] for r in _changes([{"op": "add_shelf", "compartmentId": "cmp_left", "y": 1000}])] == ["Shelf added"]


def test_new_or_resized_narrow_compartments_are_flagged():
    rows = _changes([{"op": "add_compartment", "position": 3, "width": 481}])
    assert (rows[1]["title"], rows[1]["detail"]) == ("Compartments", "64.3 · 64.3 · 14.3 · 48.1 cm")
    assert rows[2] == {"key": "narrow", "params": {"index": 3, "count": 4, "width": 143}, "title": "Narrow compartment",
                       "detail": "Compartment 3: 14.3 cm", "level": "warning"}
    assert len(rows) == 3


def test_unchanged_narrow_compartments_are_not_flagged_again():
    catalog = load_catalog()
    narrow = apply_ops(apply_ops(basic_wardrobe(), [], catalog),
                       [{"op": "modify_compartment", "compartmentId": "cmp_left", "width": 200}], catalog)
    raw = [{"op": "modify_compartment", "compartmentId": "cmp_middle", "width": 700}]
    result = apply_ops(narrow, raw, catalog)
    titles = [r["title"] for r in describe_ops(parse_ops(raw), narrow, result, catalog)]
    assert "Narrow compartment" not in titles


def test_prompt_documents_door_ids_and_the_new_rules():
    from app.agent.prompts import system_prompt
    prompt = system_prompt(load_catalog())
    assert "id?, compartmentIds, hingeSide" in prompt
    assert "Propose only the ops the customer asked for" in prompt
    assert "Never pick an arbitrary width" in prompt
    assert "never say you are proposing" in prompt
    assert "Do not state calculated sizes" in prompt


def test_item_changes_name_their_compartment():
    catalog = load_catalog()
    base = apply_ops(basic_wardrobe(), [], catalog)
    shelf_id = base["compartments"][0]["shelves"][0]["id"]
    raw = [{"op": "modify_shelf", "id": shelf_id, "y": 300}, {"op": "remove_component", "id": shelf_id}]
    result = apply_ops(base, raw, catalog)
    changes = describe_ops(parse_ops(raw), base, result, catalog)
    assert [(c["title"], c["detail"]) for c in changes] == [("Shelf in compartment 1", "at 30.0 cm"),
                                                            ("Removed", "Shelf in compartment 1")]
    assert changes[0]["key"] == "item" and changes[0]["params"] == {"ref": {"kind": "shelf", "compartment": 1, "compartments": 3}, "y": 300}
    assert changes[1]["params"] == {"ref": {"kind": "shelf", "compartment": 1, "compartments": 3}}


def test_parse_arguments_only_accepts_json_objects():
    assert parse_arguments('{"a": 1}') == {"a": 1}
    assert parse_arguments("[1]") is None
    assert parse_arguments("not json") is None


def openai_client(create):
    client = OpenAIClient(api_key="sk-test", model="test-model")
    client._client = SimpleNamespace(responses=SimpleNamespace(create=create))
    return client


def test_openai_client_returns_the_first_function_call():
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(output=[SimpleNamespace(type="reasoning"),
                                       SimpleNamespace(type="function_call", name="respond", arguments='{"message":"hi"}')],
                               output_text="")

    assert openai_client(create).call("sys", [{"role": "user", "content": "x"}], []) == ToolCall("respond", {"message": "hi"})
    assert calls[0]["store"] is False and calls[0]["tool_choice"] == "required"


def test_openai_client_falls_back_to_text():
    create = lambda **_: SimpleNamespace(output=[], output_text="plain")  # noqa: E731
    assert openai_client(create).call("sys", [], []) == "plain"


def _status_error(cls, status, code):
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx.Response(status, request=request)
    return cls("upstream said no", response=response, body={"code": code})


@pytest.mark.parametrize("error,reason", [
    (_status_error(openai.RateLimitError, 429, "credit_balance_exhausted"), "quota"),
    (_status_error(openai.RateLimitError, 429, "rate_limit_exceeded"), "rate_limited"),
    (_status_error(openai.AuthenticationError, 401, "invalid_api_key"), "auth"),
    (openai.APITimeoutError(request=httpx.Request("POST", "https://api.openai.com")), "network"),
    (_status_error(openai.InternalServerError, 500, "server_error"), "upstream"),
])
def test_openai_errors_map_to_safe_reasons(error, reason):
    def create(**_):
        raise error

    with pytest.raises(AgentUnavailable) as caught:
        openai_client(create).call("sys", [], [])
    assert caught.value.reason == reason


@pytest.mark.parametrize("raw,key,params", [
    ({"op": "update_dimensions", "width": 2400}, "dimensions", {"width": 2400}),
    ({"op": "configure_doors", "type": "sliding", "count": 3}, "doors", {"type": "sliding", "count": 3}),
    ({"op": "add_shelf", "compartmentId": "cmp_middle", "y": 1000}, "shelfAdded",
     {"ref": {"kind": "compartment", "index": 2, "count": 3}, "y": 1000}),
    ({"op": "set_material", "target": "doors", "color": {"catalogId": "walnut"}}, "material",
     {"target": {"kind": "doors"}, "values": [{"field": "color", "catalogId": "walnut"}]}),
    ({"op": "set_material", "target": "carcass", "color": {"custom": True, "name": "Sage"}}, "material",
     {"target": {"kind": "carcass"}, "values": [{"field": "color", "custom": "Sage"}]}),
    ({"op": "remove_component", "id": "dr_left"}, "removed", {"ref": {"kind": "door", "index": 1, "count": 3}}),
])
def test_rows_carry_language_neutral_keys_and_params(raw, key, params):
    row = _changes([raw])[0]
    assert row["key"] == key and row["params"] == params
    assert row["title"] and row["detail"]  # English fallback is always present


def test_every_index_comes_with_the_count_of_its_kind():
    """So a right-to-left interface can number from the right (Obsidian 04)."""
    catalog = load_catalog()
    base = apply_ops(basic_wardrobe(), [], catalog)
    raw = [{"op": "add_compartment", "position": 3, "width": 481},
           {"op": "remove_component", "id": base["partitions"][0]["id"]}]
    rows = describe_ops(parse_ops(raw[:1]), base, apply_ops(base, raw[:1], catalog), catalog)
    assert rows[0]["params"] == {"position": 4, "count": 4, "width": 481}
    assert rows[0]["detail"] == "Position 4, width 48.1 cm"  # the English fallback still counts from the left
    [removed] = describe_ops(parse_ops(raw[1:]), base, base, catalog)
    assert removed["params"] == {"ref": {"kind": "partition", "index": 1, "count": 2}}
