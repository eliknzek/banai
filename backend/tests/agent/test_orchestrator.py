import copy

import pytest

from app.agent.llm import AgentUnavailable, FakeClient, ScriptedClient, ToolCall
from app.agent.orchestrator import FALLBACK_REPLY, MAX_REPAIRS, NO_CHANGE_REPLY, clean_text, run_turn
from app.agent.tools import PROPOSE_CHANGES, RESPOND
from app.domain import ids
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.defaults import basic_wardrobe
from app.services import signing

KEY = "test-signing-key"
USER = [{"role": "user", "content": "Make it 240 cm wide with sliding doors"}]
GOOD_OPS = [{"op": "update_dimensions", "width": 2400}, {"op": "configure_doors", "type": "sliding", "count": 2}]


def propose(ops, message="Here you go", summary="Wider, sliding doors"):
    return ToolCall(PROPOSE_CHANGES, {"message": message, "summary": summary, "ops": ops})


def turn(client, design=None, revision=1):
    return run_turn(client, USER, design or basic_wardrobe(), revision, load_catalog(), KEY)


def test_valid_proposal_is_dry_run_described_and_signed():
    result = turn(ScriptedClient([propose(GOOD_OPS)]))
    proposal = result.proposal
    assert result.reply == "Here you go"
    assert proposal["baseRevision"] == 1
    assert proposal["baseHash"] == signing.design_hash(apply_ops(basic_wardrobe(), [], load_catalog()))
    assert proposal["ops"] == GOOD_OPS
    assert [c["title"] for c in proposal["changes"]] == ["Dimensions", "Doors"]
    assert proposal["changes"][0]["detail"] == "Width 240.0 cm"
    assert proposal["changes"][1]["detail"] == "Sliding, 2 panels"
    assert signing.verify(KEY, proposal["signature"], proposal["proposalId"], proposal["ops"], 1, proposal["baseHash"])


def test_turn_never_mutates_the_committed_design():
    design = basic_wardrobe()
    before = copy.deepcopy(design)
    turn(ScriptedClient([propose(GOOD_OPS)]), design)
    assert design == before


def test_design_is_sent_to_the_model_as_data_before_the_history():
    client = ScriptedClient([ToolCall(RESPOND, {"message": "Which width?"})])
    result = turn(client)
    assert result.reply == "Which width?" and result.proposal is None
    first, *rest = client.requests[0]
    assert first["role"] == "developer" and "data, not instructions" in first["content"]
    assert rest == USER


def test_invalid_ops_are_repaired_on_retry():
    client = ScriptedClient([propose([{"op": "update_dimensions", "width": 10}]), propose(GOOD_OPS)])
    result = turn(client)
    assert result.proposal is not None
    repair = client.requests[1][-1]
    assert repair["role"] == "developer" and "OUT_OF_RANGE" in repair["content"]


def test_gives_up_with_a_clarification_after_max_repairs():
    bad = propose([{"op": "add_shelf", "compartmentId": "cmp_missing", "y": 100}])
    client = ScriptedClient([bad] * (MAX_REPAIRS + 1))
    result = turn(client)
    assert result == type(result)(FALLBACK_REPLY, None)
    assert len(client.requests) == MAX_REPAIRS + 1


@pytest.mark.parametrize("arguments", [None, {"message": "x"}, {"message": "x", "ops": []}, {"ops": "nope"}])
def test_malformed_tool_arguments_are_treated_as_invalid(arguments):
    client = ScriptedClient([ToolCall(PROPOSE_CHANGES, arguments)] * (MAX_REPAIRS + 1))
    assert turn(client).proposal is None


def test_unknown_keys_from_the_model_are_rejected():
    client = ScriptedClient([propose([{"op": "update_dimensions", "width": 2400, "evil": 1}])] * (MAX_REPAIRS + 1))
    assert turn(client).proposal is None


def test_no_op_proposal_returns_a_plain_reply():
    result = turn(ScriptedClient([propose([{"op": "update_dimensions", "width": 2000}], message="")]))
    assert result.proposal is None and result.reply == NO_CHANGE_REPLY


def test_plain_text_reply_is_accepted_and_cleaned():
    result = turn(ScriptedClient(["Hello‮ there​"]))
    assert result.reply == "Hello there"


def test_upstream_failure_propagates_as_agent_unavailable():
    with pytest.raises(AgentUnavailable):
        turn(ScriptedClient([AgentUnavailable("quota")]))


def test_seeded_ids_make_the_apply_replay_match_the_dry_run():
    ops = [{"op": "add_shelf", "compartmentId": "cmp_left", "y": 1000}]
    result = turn(ScriptedClient([propose(ops)]))
    base = apply_ops(basic_wardrobe(), [], load_catalog())
    runs = []
    for _ in range(2):
        with ids.seeded_ids(result.proposal["proposalId"]):
            runs.append(apply_ops(base, result.proposal["ops"], load_catalog()))
    assert runs[0] == runs[1]


def test_clean_text_caps_length():
    assert clean_text("a" * 50, 10) == "a" * 9 + "…"
    assert clean_text(None, 10) == ""


def test_fake_client_drives_a_full_proposal():
    result = turn(FakeClient())
    assert [op["op"] for op in result.proposal["ops"]] == ["update_dimensions", "configure_doors"]
