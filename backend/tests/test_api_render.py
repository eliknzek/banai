import base64
import copy
from types import SimpleNamespace

import httpx2 as httpx
import openai
import pytest
from fastapi.testclient import TestClient

from app.agent.llm import AgentUnavailable
from app.agent.render_prompt import render_prompt
from app.api import render
from app.api.common import limiter
from app.config import Settings, get_settings
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.defaults import basic_wardrobe
from app.main import app
from app.services import signing
from app.services.imaging import FakeImages, OpenAIImages

SETTINGS = Settings(_env_file=None, proposal_signing_key="k", openai_api_key="", openai_chat_model="")
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 2048
client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated():
    limiter.reset()
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    yield
    app.dependency_overrides.clear()


def use_images(images=None):
    images = images or FakeImages()
    app.dependency_overrides[render.get_image_client] = lambda: images
    return images


def body(design=None, image=PNG, **extra):
    return {"design": design or basic_wardrobe(), "image": base64.b64encode(image).decode(), **extra}


def test_render_returns_the_image_and_never_changes_the_design():
    images = use_images()
    design = basic_wardrobe()
    before = signing.design_hash(apply_ops(copy.deepcopy(design), [], load_catalog()))
    response = client.post("/api/render", json=body(design))
    assert response.status_code == 200
    data = response.json()["data"]
    assert base64.b64decode(data["imageBase64"]) == PNG  # FakeImages returns the uploaded capture
    assert data["mimeType"] == "image/png"
    assert signing.design_hash(apply_ops(design, [], load_catalog())) == before
    assert len(images.prompts) == 1


def test_prompt_is_built_from_the_design_only():
    design = apply_ops(basic_wardrobe(), [
        {"op": "update_dimensions", "width": 2600},
        {"op": "configure_doors", "type": "sliding", "count": 2},
        {"op": "set_material", "target": "doors", "color": {"catalogId": "walnut"}},
        {"op": "set_material", "target": "carcass", "color": {"custom": True, "name": "Sage", "hex": "#9caf88"}},
    ], load_catalog())
    prompt = render_prompt(design, load_catalog(), doors_visible=True)
    assert "260.0 cm wide" in prompt and "240.0 cm high" in prompt and "60.0 cm deep" in prompt
    assert "2 sliding door panels" in prompt and "walnut" in prompt
    assert 'custom colour "Sage" (#9caf88)' in prompt
    assert "compartment 1" in prompt and "Do not add, remove or move anything" in prompt
    assert "interior is visible" in render_prompt(design, load_catalog(), doors_visible=False)


def test_doors_visibility_is_passed_through():
    images = use_images()
    client.post("/api/render", json=body(doorsVisible=False))
    assert "interior is visible" in images.prompts[0]


@pytest.mark.parametrize("image,status", [
    (b"GIF89a" + b"\x00" * 2048, 415),
    (b"\x89PNG\r\n\x1a\n" + b"\x00" * (render.MAX_IMAGE_BYTES + 1), 413),
])
def test_only_reasonable_pngs_are_accepted(image, status):
    use_images()
    assert client.post("/api/render", json=body(image=image)).status_code == status


def test_non_base64_image_is_rejected():
    use_images()
    payload = body()
    payload["image"] = "not base64 at all!!" * 2
    assert client.post("/api/render", json=payload).status_code == 415


def test_invalid_design_is_rejected_before_rendering():
    images = use_images()
    design = basic_wardrobe()
    design["dimensions"]["width"] = 999
    response = client.post("/api/render", json=body(design))
    assert response.status_code == 422 and response.json()["error"]["code"] == "INVALID_DESIGN"
    assert images.prompts == []


def test_render_without_configuration_is_unavailable():
    response = client.post("/api/render", json=body())
    assert response.status_code == 503 and response.json()["error"]["reason"] == "not_configured"


class Failing(FakeImages):
    def render(self, reference_png, prompt):
        raise AgentUnavailable("quota")


def test_upstream_failure_is_reported_safely():
    use_images(Failing())
    response = client.post("/api/render", json=body())
    assert response.status_code == 503
    assert response.json()["error"] == {"code": "AGENT_UNAVAILABLE", "message": render.UNAVAILABLE_MESSAGES["quota"], "reason": "quota"}


def test_render_is_rate_limited():
    use_images()
    statuses = [client.post("/api/render", json=body()).status_code for _ in range(6)]
    assert statuses[:5] == [200] * 5 and statuses[5] == 429


@pytest.mark.parametrize("model,fidelity", [("gpt-image-2.5-sunburst", None), ("gpt-image-1.5", "high")])
def test_openai_images_uses_the_capture(model, fidelity):
    calls = []
    jpeg = b"\xff\xd8\xff" + b"\x00" * 10

    def edit(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(jpeg).decode())])

    images = OpenAIImages("sk-test", model)
    images._client = SimpleNamespace(images=SimpleNamespace(edit=edit))
    assert images.render(PNG, "prompt") == (jpeg, "image/jpeg")
    call = calls[0]
    assert call["model"] == model and call.get("input_fidelity") == fidelity  # only models that accept it
    assert call["image"][0] == "wardrobe.png" and call["image"][1].getvalue() == PNG
    assert call["output_format"] == "jpeg"


def test_openai_images_errors_map_to_safe_reasons():
    request = httpx.Request("POST", "https://api.openai.com/v1/images/edits")
    error = openai.RateLimitError("no", response=httpx.Response(429, request=request), body={"code": "insufficient_quota"})

    def edit(**_):
        raise error

    images = OpenAIImages("sk-test", "m")
    images._client = SimpleNamespace(images=SimpleNamespace(edit=edit))
    with pytest.raises(AgentUnavailable) as caught:
        images.render(PNG, "p")
    assert caught.value.reason == "quota"


def test_empty_upstream_result_is_unavailable():
    images = OpenAIImages("sk-test", "m")
    images._client = SimpleNamespace(images=SimpleNamespace(edit=lambda **_: SimpleNamespace(data=[])))
    with pytest.raises(AgentUnavailable):
        images.render(PNG, "p")
