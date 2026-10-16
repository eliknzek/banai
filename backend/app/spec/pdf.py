"""The carpenter spec as a PDF (ReportLab), in Hebrew (right to left) or English.

ReportLab draws text left to right, so Hebrew is wrapped in logical order first and each line is
then put in visual order with python-bidi (numbers keep their order; brackets are mirrored).
"""

from __future__ import annotations

import io
from datetime import date
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

from bidi import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.spec.parts import Spec, derive
from app.spec.strings import STRINGS, text

FONT = "NotoSansHebrew"
FONT_PATH = Path(__file__).with_name("fonts") / "NotoSansHebrew-VF.ttf"
ACCENT = colors.HexColor("#b4532a")
INK = colors.HexColor("#231917")
MUTED = colors.HexColor("#6b5d58")
LINE = colors.HexColor("#e6d9d1")
SOFT = colors.HexColor("#fbf2ec")
MIRROR = str.maketrans("()[]", ")(][")


@lru_cache
def _register_font() -> str:
    pdfmetrics.registerFont(TTFont(FONT, str(FONT_PATH)))
    return FONT


def cm(mm_value: int) -> str:
    return f"{mm_value / 10:.1f}"


class Writer:
    """Language-aware text: wrapping, bidi order and alignment."""

    def __init__(self, locale: str) -> None:
        self.locale = locale
        self.rtl = locale == "he"
        self.font = _register_font()

    def t(self, key: str, **params) -> str:
        return text(self.locale, key, **params)

    def num(self, index: int, count: int) -> int:
        """Displayed number of the index-th (1-based, from the left) of `count` side-by-side
        parts: right-to-left languages count from the right."""
        return count - index + 1 if self.rtl else index

    def visual(self, line: str) -> str:
        return get_display(line).translate(MIRROR) if self.rtl else line

    def lines(self, value: str, size: float, width: float) -> list[str]:
        return [self.visual(line) for line in simpleSplit(value, self.font, size, width)]

    def style(self, size: float = 10, color=INK, leading: float | None = None, space_after: float = 0) -> ParagraphStyle:
        return ParagraphStyle("p", fontName=self.font, fontSize=size, leading=leading or size * 1.45, textColor=color,
                              alignment=TA_RIGHT if self.rtl else TA_LEFT, spaceAfter=space_after)

    def para(self, value: str, width: float, size: float = 10, color=INK, space_after: float = 0) -> Paragraph:
        body = "<br/>".join(escape(line) for line in self.lines(value, size, width)) or " "
        return Paragraph(body, self.style(size, color, space_after=space_after))


INTERIOR_KEYS = ("shelf", "drawerFront", "rail")


def _in_reading_order(parts: list, w: Writer, count: int) -> list:
    """Carcass, then interior items, then doors; in a right-to-left language each group is listed
    by the displayed compartment number (stable, so the order inside a compartment is kept)."""
    def key(part):
        if part.key in INTERIOR_KEYS:
            return (1, w.num(part.note["compartment"], count))
        if part.key == "hingedDoor":
            return (2, min(w.num(i, count) for i in part.note["compartments"]))
        return (2 if part.key == "slidingPanel" else 0, 0)
    return sorted(parts, key=key)


class Elevation(Flowable):
    """Front view to scale: carcass, partitions, shelves, drawers and rails, with dimensions in cm."""

    def __init__(self, spec: Spec, writer: Writer, width: float, height: float, doors: bool = False) -> None:
        super().__init__()
        self.spec, self.w, self.doors = spec, writer, doors
        self.width, self.height = width, height

    def wrap(self, *_):
        return self.width, self.height

    def draw(self) -> None:
        c, s, w = self.canv, self.spec, self.w
        margin = 14 * mm
        scale = min((self.width - 2 * margin) / s.width, (self.height - 2 * margin) / s.height)
        ox = (self.width - s.width * scale) / 2
        oy = margin
        X = lambda v: ox + v * scale  # noqa: E731
        Y = lambda v: oy + v * scale  # noqa: E731
        c.setStrokeColor(INK)
        c.setLineWidth(0.8)
        c.setFillColor(colors.white)
        c.rect(X(0), Y(0), s.width * scale, s.height * scale, stroke=1, fill=1)
        c.setFillColor(colors.HexColor("#efe7e1"))
        for x0, x1 in ((0, s.panel), (s.width - s.panel, s.width)):
            c.rect(X(x0), Y(0), (x1 - x0) * scale, s.height * scale, stroke=1, fill=1)
        for y0 in (0, s.height - s.panel):
            c.rect(X(s.panel), Y(y0), (s.width - 2 * s.panel) * scale, s.panel * scale, stroke=1, fill=1)
        c.setFont(w.font, 7)
        base = s.panel
        for comp in s.compartments:
            left, right = s.panel + comp["x0"], s.panel + comp["x1"]
            if comp["index"] > 1:
                part_w = left - (s.panel + s.compartments[comp["index"] - 2]["x1"])
                c.setStrokeColor(INK)
                c.setFillColor(colors.HexColor("#efe7e1"))
                c.rect(X(left - part_w), Y(s.panel), part_w * scale, (s.height - 2 * s.panel) * scale, stroke=1, fill=1)
            if not self.doors:
                for y in comp["shelves"]:
                    c.setFillColor(colors.HexColor("#d9cbc1"))
                    c.rect(X(left), Y(base + y), (right - left) * scale, max(18 * scale, 0.8), stroke=0, fill=1)
                    c.setFillColor(INK)
                    c.drawString(X(left) + 1.5, Y(base + y) + 2.2, cm(y))
                for y, h in comp["drawers"]:
                    c.setStrokeColor(INK)
                    c.setFillColor(colors.HexColor("#f6efea"))
                    c.rect(X(left) + 1.5, Y(base + y) + 1, (right - left) * scale - 3, h * scale - 2, stroke=1, fill=1)
                    c.setFillColor(INK)
                    c.drawCentredString(X((left + right) / 2), Y(base + y + h / 2) - 2, f"{cm(y)} / {cm(h)}")
                for y in comp["rails"]:
                    c.setStrokeColor(ACCENT)
                    c.setDash(3, 2)
                    c.line(X(left) + 3, Y(base + y), X(right) - 3, Y(base + y))
                    c.setDash()
                    c.setFillColor(ACCENT)
                    c.drawString(X(left) + 1.5, Y(base + y) + 2.2, cm(y))
            c.setFillColor(INK)
            c.setFont(w.font, 7.5)
            label = w.visual(w.t("compartmentShort", i=w.num(comp["index"], len(s.compartments))))
            c.drawCentredString(X((left + right) / 2), Y(s.height) - 9, label)
            c.setFont(w.font, 7)
            self._hdim(left, right, Y(0) - 7, X, cm(comp["width"]))
        if self.doors:
            self._door_lines(X, Y)
        self._hdim(0, s.width, Y(s.height) + 9, X, cm(s.width), size=8)
        self._vdim(Y(0), Y(s.height), X(0) - 9, cm(s.height))

    def _door_lines(self, X, Y) -> None:
        c, s = self.canv, self.spec
        c.setStrokeColor(ACCENT)
        c.setLineWidth(0.7)
        doors = [p for p in s.parts if p.key in ("hingedDoor", "slidingPanel")]
        if not doors:
            return
        if doors[0].key == "slidingPanel":
            panel = doors[0]
            step = panel.size[0] - panel.note.get("overlap", 0)
            for i in range(panel.qty):
                x0 = s.panel + i * step
                c.rect(X(x0), Y(s.panel + 2), panel.size[0] * self_scale(X), panel.size[1] * self_scale(X), stroke=1, fill=0)
            return
        for door in doors:
            first, last = door.note["compartments"]
            x0 = s.panel + s.compartments[first - 1]["x0"] + 2
            x1 = x0 + door.size[0]
            y0, y1 = Y(s.panel + 2), Y(s.panel + 2 + door.size[1])
            c.rect(X(x0), y0, X(x1) - X(x0), y1 - y0, stroke=1, fill=0)
            hinge_x = X(x0) if door.note["hinge"] == "left" else X(x1)
            free_x = X(x1) if door.note["hinge"] == "left" else X(x0)
            c.setDash(2, 2)
            c.line(free_x, y0, hinge_x, (y0 + y1) / 2)  # opening symbol: lines meet at the hinge side
            c.line(free_x, y1, hinge_x, (y0 + y1) / 2)
            c.setDash()

    def _hdim(self, a: int, b: int, y: float, X, label: str, size: float = 7) -> None:
        c = self.canv
        c.setStrokeColor(MUTED)
        c.setLineWidth(0.4)
        c.line(X(a), y, X(b), y)
        for x in (X(a), X(b)):
            c.line(x, y - 2, x, y + 2)
        c.setFillColor(INK)
        c.setFont(self.w.font, size)
        c.drawCentredString((X(a) + X(b)) / 2, y + 2, label)

    def _vdim(self, y0: float, y1: float, x: float, label: str) -> None:
        c = self.canv
        c.setStrokeColor(MUTED)
        c.setLineWidth(0.4)
        c.line(x, y0, x, y1)
        for y in (y0, y1):
            c.line(x - 2, y, x + 2, y)
        c.saveState()
        c.translate(x - 2.5, (y0 + y1) / 2)
        c.rotate(90)
        c.setFillColor(INK)
        c.setFont(self.w.font, 8)
        c.drawCentredString(0, 0, label)
        c.restoreState()


def self_scale(X) -> float:
    return X(1) - X(0)


def _appearance(appearance: dict, catalog_names: dict) -> str:
    parts = []
    for field in ("material", "color", "finish"):
        ref = appearance.get(field) or {}
        if ref.get("custom"):
            parts.append(ref["name"])
        elif ref.get("catalogId"):
            parts.append(catalog_names.get(ref["catalogId"], ref["catalogId"]))
    return " · ".join(parts)


def _find_appearance(design: dict, item_id: str) -> dict | None:
    for compartment in design["compartments"]:
        for kind in ("shelves", "drawers"):
            for item in compartment[kind]:
                if item["id"] == item_id:
                    return item.get("appearance")
    for door in design["doors"]["items"]:
        if door["id"] == item_id:
            return door.get("appearance")
    return None


def build_spec_pdf(design: dict, render: bytes | None, locale: str = "he", today: date | None = None) -> bytes:
    w = Writer(locale if locale in STRINGS else "he")
    names = STRINGS[w.locale]["catalog"]
    spec = derive(design)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm,
                            bottomMargin=20 * mm, title=w.t("title"), author="BanAI")
    width = doc.width

    def footer(canvas, document) -> None:
        canvas.saveState()
        canvas.setFont(w.font, 7.5)
        canvas.setFillColor(MUTED)
        canvas.setStrokeColor(LINE)
        canvas.line(16 * mm, 14 * mm, A4[0] - 16 * mm, 14 * mm)
        note, page = w.visual(w.t("footer")), w.visual(w.t("page", n=document.page))
        if w.rtl:
            canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, note)
            canvas.drawString(16 * mm, 9 * mm, page)
        else:
            canvas.drawString(16 * mm, 9 * mm, note)
            canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, page)
        canvas.restoreState()

    def heading(key: str, size: float = 15) -> Paragraph:
        return w.para(w.t(key), width, size=size, color=ACCENT, space_after=4)

    def table(rows: list[list], col_widths: list[float], header: bool = True) -> Table:
        if w.rtl:  # the first logical column sits on the right
            rows = [list(reversed(r)) for r in rows]
            col_widths = list(reversed(col_widths))
        cells = [[cell if isinstance(cell, Flowable) else w.para(str(cell), cw - 8, size=9) for cell, cw in zip(r, col_widths)]
                 for r in rows]
        tbl = Table(cells, colWidths=col_widths, repeatRows=1 if header else 0)
        style = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
                 ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
        if header:
            style += [("BACKGROUND", (0, 0), (-1, 0), SOFT)]
        tbl.setStyle(TableStyle(style))
        return tbl

    story: list = []
    # Page 1: cover
    story += [w.para(w.t("title"), width, size=22, space_after=2),
              w.para(w.t("subtitle", date=(today or date.today()).strftime("%d.%m.%Y")), width, size=10, color=MUTED, space_after=10)]
    doors_text = w.t(f"doors.{spec.door_type}", n=len(design["doors"]["items"]))
    summary = [
        [w.t("overall"), w.t("overallValue", w=cm(spec.width), h=cm(spec.height), d=cm(spec.depth))],
        [w.t("compartmentsLabel"), str(len(spec.compartments))],
        [w.t("doorsLabel"), doors_text],
        [w.t("carcassLabel"), _appearance(design["carcass"]["appearance"], names)],
    ]
    if spec.door_type != "none":
        summary.append([w.t("doorsFinishLabel"), _appearance(design["doors"]["appearance"], names)])
    summary.append([w.t("panelLabel"), w.t("cmValue", v=cm(spec.panel))])
    story += [heading("summary", 13), table(summary, [width * 0.32, width * 0.68], header=False), Spacer(1, 8)]
    if render:
        reader = ImageReader(io.BytesIO(render))
        iw, ih = reader.getSize()
        img_w = width
        img_h = min(img_w * ih / iw, 105 * mm)
        img_w = img_h * iw / ih
        story += [heading("illustration", 13), Image(io.BytesIO(render), width=img_w, height=img_h),
                  w.para(w.t("illustrationNote"), width, size=8, color=MUTED, space_after=6)]
    disclaimer = Table([[w.para(w.t("disclaimerTitle"), width - 16, size=10, color=ACCENT)],
                        [w.para(w.t("disclaimer"), width - 16, size=9)]], colWidths=[width])
    disclaimer.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SOFT), ("BOX", (0, 0), (-1, -1), 0.6, ACCENT),
                                    ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8)]))
    story += [KeepTogether([disclaimer]), PageBreak()]

    # Page 2: drawings
    story += [heading("elevation"), w.para(w.t("elevationNote"), width, size=8.5, color=MUTED, space_after=4),
              Elevation(spec, w, width, 132 * mm)]
    if spec.door_type != "none":  # both drawings fit on one A4 page
        story += [Spacer(1, 2), heading("doorsView", 12), Elevation(spec, w, width, 80 * mm, doors=True)]
    story.append(PageBreak())

    # Page 3: parts
    rows = [[w.t("col.part"), w.t("col.qty"), w.t("col.size"), w.t("col.finish")]]
    n = len(spec.compartments)
    for part in _in_reading_order(spec.parts, w, n):
        size = "—" if part.key == "rail" else " × ".join(cm(v) for v in part.size)
        if part.finish in ("carcass", "doors", "hardware"):
            finish = w.t(f"finish.{part.finish}")
        else:
            finish = w.t("finish.custom", value=_appearance(_find_appearance(design, part.finish) or {}, names))
        notes = []
        if part.key in ("shelf", "drawerFront"):
            notes.append(w.t("note.inCompartment", c=w.num(part.note["compartment"], n), y=cm(part.note["y"])))
        elif part.key == "rail":
            notes.append(w.t("note.railLength", c=w.num(part.note["compartment"], n), y=cm(part.note["y"]), l=cm(part.size[0])))
        elif part.key == "hingedDoor":
            first, last = sorted(w.num(i, n) for i in part.note["compartments"])
            key = "note.hinge" if last != first else "note.hingeOne"
            notes.append(w.t(key, side=w.t(f"side.{part.note['hinge']}"), range=f"{first}–{last}" if last != first else str(first)))
        elif part.key == "slidingPanel" and part.note.get("overlap"):
            notes.append(w.t("note.overlap", o=cm(part.note["overlap"])))
        rows.append([w.t(f"part.{part.key}"), str(part.qty), size, " · ".join([finish, *notes])])
    story += [heading("partsTitle"), w.para(w.t("partsNote"), width, size=8.5, color=MUTED, space_after=4),
              table(rows, [width * 0.22, width * 0.09, width * 0.27, width * 0.42]), PageBreak()]

    # Page 4: hardware, assembly, checks
    hw_rows = [[w.t(f"hw.{key}"), str(count)] for key, count in spec.hardware]
    story += [heading("hardwareTitle"), w.para(w.t("hardwareNote"), width, size=8.5, color=MUTED, space_after=4)]
    if hw_rows:
        story.append(table(hw_rows, [width * 0.75, width * 0.25], header=False))
    story += [Spacer(1, 10), heading("assemblyTitle")]
    story += [w.para(f"{i}. {step}", width, size=10, space_after=3) for i, step in enumerate(STRINGS[w.locale]["steps"], start=1)]
    story += [Spacer(1, 10), heading("checksTitle")]
    story += [w.para(f"• {item}", width, size=10, space_after=3) for item in STRINGS[w.locale]["checks"]]

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
