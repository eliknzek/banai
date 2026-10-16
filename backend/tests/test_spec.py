import base64
import io

import pytest
from bidi import get_display
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.api.common import limiter
from app.config import Settings, get_settings
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.defaults import basic_wardrobe
from app.main import app
from app.services import signing
from app.spec.parts import derive, hinges_for
from app.spec.pdf import Writer, build_spec_pdf

CATALOG = load_catalog()
BASIC = apply_ops(basic_wardrobe(), [], CATALOG)
SLIDING = apply_ops(BASIC, [{"op": "update_dimensions", "width": 2600},
                            {"op": "configure_doors", "type": "sliding", "count": 2},
                            {"op": "set_material", "target": "doors", "color": {"catalogId": "walnut"}}], CATALOG)
JPEG = b"\xff\xd8\xff" + b"\x00" * 64
client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated():
    limiter.reset()
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    yield
    app.dependency_overrides.clear()


def parts_of(spec, key):
    return [p for p in spec.parts if p.key == key]


def text_of(pdf: bytes) -> str:
    return "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)


class TestParts:
    def test_carcass_parts_match_the_3d_model(self):
        spec = derive(BASIC)
        assert parts_of(spec, "side")[0].qty == 2 and parts_of(spec, "side")[0].size == (600, 2400, 18)
        assert parts_of(spec, "topBottom")[0].size == (1964, 600, 18)
        assert parts_of(spec, "back")[0].size == (1964, 2364, 6)
        assert [p.size for p in parts_of(spec, "partition")] == [(594, 2364, 18)] * 2

    def test_interior_items_keep_their_compartment_and_height(self):
        spec = derive(BASIC)
        shelves = parts_of(spec, "shelf")
        assert len(shelves) == 7 and shelves[0].size == (643, 594, 18) and shelves[0].note == {"compartment": 1, "y": 400}
        drawers = parts_of(spec, "drawerFront")
        assert [d.size for d in drawers] == [(636, 194, 18)] * 2  # 642 - 2*3 by 200 - 2*3, like the viewer
        assert parts_of(spec, "rail")[0].note == {"compartment": 2, "y": 1900}

    def test_hinged_doors_are_inset_with_the_model_gap(self):
        doors = parts_of(derive(BASIC), "hingedDoor")
        assert [d.size for d in doors] == [(639, 2360, 18), (639, 2360, 18), (638, 2360, 18)]
        assert [d.note["hinge"] for d in doors] == ["left", "right", "left"]

    def test_sliding_panels_include_the_overlap(self):
        spec = derive(SLIDING)
        [panels] = parts_of(spec, "slidingPanel")
        inner = 2600 - 36
        assert panels.qty == 2 and panels.size[0] == round((inner + 60) / 2) and panels.note == {"overlap": 60}
        assert ("slidingTrack", 1) in spec.hardware and ("handles", 2 + 2) in spec.hardware  # 2 panels + 2 drawers

    @pytest.mark.parametrize("height,count", [(900, 2), (1000, 2), (1500, 3), (1800, 3), (2360, 4)])
    def test_suggested_hinges_by_door_height(self, height, count):
        assert hinges_for(height) == count

    def test_suggested_hardware_counts(self):
        hardware = dict(derive(BASIC).hardware)
        assert hardware == {"hinges": 12, "drawerRunners": 2, "railBrackets": 2, "shelfSupports": 28, "handles": 5}


class TestPdf:
    def test_hebrew_pdf_has_four_pages_with_the_design_and_disclaimer(self):
        pdf = build_spec_pdf(SLIDING, JPEG_REAL, "he")
        assert pdf.startswith(b"%PDF") and len(PdfReader(io.BytesIO(pdf)).pages) == 4
        content = text_of(pdf)
        for word in ("מפרט ביצוע לארון בגדים", "כנף הזזה", "אגוז", "אינו שרטוט ייצור"):
            assert word in content, word  # pypdf reads the visually ordered line back in logical order
        assert "260.0" in content and "240.0" in content

    def test_english_pdf(self):
        content = text_of(build_spec_pdf(BASIC, None, "en"))
        for phrase in ("Wardrobe build specification", "Side panel", "Hinged door", "Not a manufacturing drawing", "196.4"):
            assert phrase in content, phrase

    def test_hebrew_counts_compartments_from_the_right(self):
        assert Writer("he").num(3, 3) == 1 and Writer("he").num(1, 3) == 3
        assert Writer("en").num(3, 3) == 3
        # The basic design's only hanging rail is in the middle compartment, shelves at 80 cm are
        # in the left and right ones: in Hebrew the right one (last in the list) is compartment 1.
        # pypdf returns table cells in visual order, so compare without spaces.
        notes = [line.replace(" ", "") for line in text_of(build_spec_pdf(BASIC, None, "he")).splitlines() if "בגובה" in line]
        right = [f"{s['y'] / 10:.1f}" for s in BASIC["compartments"][-1]["shelves"]]  # 80.0, 140.0
        assert all(any(f"{y},בגובה1תא" in line for line in notes) for y in right)
        assert f"{right[0]},בגובה1תא" in notes[0]  # listed first: the parts read from the right
        assert "מימין לשמאל" in text_of(build_spec_pdf(BASIC, None, "he"))
        english = text_of(build_spec_pdf(BASIC, None, "en"))
        assert f"Compartment 3, at {right[0]} cm" in english

    def test_hebrew_lines_are_reordered_and_brackets_mirrored(self):
        writer = Writer("he")
        assert writer.visual("לוח (MDF)") == get_display("לוח (MDF)").translate(str.maketrans("()", ")("))
        assert Writer("en").visual("Side (MDF)") == "Side (MDF)"

    def test_no_text_other_than_the_design_reaches_the_pdf(self):
        custom = apply_ops(BASIC, [{"op": "set_material", "target": "carcass",
                                    "color": {"custom": True, "name": "Sage", "hex": "#9caf88"}}], CATALOG)
        assert "Sage" in text_of(build_spec_pdf(custom, None, "en"))


# A real (tiny) JPEG for ReportLab to embed.
JPEG_REAL = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAAB"
    "AAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMR"
    "AD8AJ//Z")


class TestApi:
    def body(self, design=None, render=None, locale="he"):
        payload = {"design": design or basic_wardrobe(), "locale": locale}
        if render is not None:
            payload["render"] = base64.b64encode(render).decode()
        return payload

    def test_returns_a_pdf_and_never_changes_the_design(self):
        design = basic_wardrobe()
        before = signing.design_hash(apply_ops(design, [], CATALOG))
        response = client.post("/api/spec", json=self.body(design, JPEG_REAL))
        assert response.status_code == 200 and response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")
        assert signing.design_hash(apply_ops(design, [], CATALOG)) == before

    def test_render_is_optional(self):
        assert client.post("/api/spec", json=self.body()).status_code == 200

    @pytest.mark.parametrize("image,status", [(b"GIF89a" + b"\x00" * 64, 415), (JPEG, 422)])
    def test_bad_images_are_rejected(self, image, status):
        assert client.post("/api/spec", json=self.body(render=image)).status_code == status

    def test_invalid_design_and_unknown_locale_are_rejected(self):
        design = basic_wardrobe()
        design["dimensions"]["width"] = 999
        assert client.post("/api/spec", json=self.body(design)).status_code == 422
        assert client.post("/api/spec", json=self.body(locale="fr")).status_code == 422

    def test_is_rate_limited(self):
        statuses = [client.post("/api/spec", json=self.body()).status_code for _ in range(11)]
        assert statuses[:10] == [200] * 10 and statuses[10] == 429


class TestImageSafety:
    def png(self, width, height):
        from PIL import Image
        out = io.BytesIO()
        Image.new("RGB", (width, height), "white").save(out, "PNG")
        return out.getvalue()

    def test_a_small_file_with_huge_pixel_size_is_rejected_before_decoding(self):
        bomb = self.png(9000, 9000)  # ~240 KB on disk, ~1 GB once decoded
        assert len(bomb) < 1024 * 1024
        response = TestApi().body(render=bomb)
        assert client.post("/api/spec", json=response).status_code == 413

    def test_the_render_is_re_encoded_as_a_bounded_jpeg(self):
        from app.api.spec import normalize_render
        from PIL import Image
        cover = normalize_render(self.png(3000, 2000))
        assert cover.startswith(b"\xff\xd8\xff")
        assert max(Image.open(io.BytesIO(cover)).size) == 1600
