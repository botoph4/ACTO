#!/usr/bin/env python3
"""Regenerate the ACTO manual's scheduling metrics page and replace it in-place."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
MANUAL_PATH = ROOT / "docs" / "ACTO-Cycle-Studio-使用说明.pdf"
TARGET_PAGE_INDEX = 9
VERSION = "0.2.4"

NAVY = colors.HexColor("#0B1733")
BLUE = colors.HexColor("#315EFB")
MUTED = colors.HexColor("#738196")
TEXT = colors.HexColor("#24324A")
LINE = colors.HexColor("#DEE5EF")
SOFT_BLUE = colors.HexColor("#F3F7FF")
SOFT_WARM = colors.HexColor("#FFF8E9")
SOFT_GREEN = colors.HexColor("#EFF9F5")

FONT_REGULAR_PATH = Path("/System/Library/Fonts/STHeiti Light.ttc")
FONT_BOLD_PATH = Path("/System/Library/Fonts/STHeiti Medium.ttc")
FONT_UNICODE_PATH = Path(
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
)


def register_fonts() -> tuple[str, str]:
    if FONT_REGULAR_PATH.is_file() and FONT_BOLD_PATH.is_file():
        pdfmetrics.registerFont(
            TTFont("ACTOManual", str(FONT_REGULAR_PATH), subfontIndex=0)
        )
        pdfmetrics.registerFont(
            TTFont("ACTOManualBold", str(FONT_BOLD_PATH), subfontIndex=0)
        )
        regular, bold = "ACTOManual", "ACTOManualBold"
    elif FONT_UNICODE_PATH.is_file():
        pdfmetrics.registerFont(TTFont("ACTOManual", str(FONT_UNICODE_PATH)))
        regular = bold = "ACTOManual"
    else:
        raise RuntimeError(
            "未找到可嵌入的中文字体。请安装 Arial Unicode 或 STHeiti 字体。"
        )

    pdfmetrics.registerFontFamily(
        "ACTOManual",
        normal=regular,
        bold=bold,
        italic=regular,
        boldItalic=bold,
    )
    return regular, bold


def make_styles(regular: str, bold: str) -> dict[str, ParagraphStyle]:
    return {
        "section": ParagraphStyle(
            "Section",
            fontName=bold,
            fontSize=7.5,
            leading=10,
            textColor=BLUE,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "title": ParagraphStyle(
            "Title",
            fontName=bold,
            fontSize=23,
            leading=28,
            textColor=NAVY,
            spaceAfter=12,
            wordWrap="CJK",
        ),
        "lead": ParagraphStyle(
            "Lead",
            fontName=regular,
            fontSize=10.5,
            leading=17,
            textColor=MUTED,
            spaceAfter=16,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "Heading2",
            fontName=bold,
            fontSize=13,
            leading=18,
            textColor=NAVY,
            spaceBefore=4,
            spaceAfter=9,
            wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "Body",
            fontName=regular,
            fontSize=9.4,
            leading=15.5,
            textColor=TEXT,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            fontName=regular,
            fontSize=9.2,
            leading=15,
            textColor=TEXT,
            leftIndent=14,
            bulletIndent=1,
            bulletFontName=bold,
            bulletFontSize=7.5,
            bulletColor=BLUE,
            spaceAfter=5,
            wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "Table",
            fontName=regular,
            fontSize=8.3,
            leading=12.4,
            textColor=TEXT,
            wordWrap="CJK",
        ),
        "table_head": ParagraphStyle(
            "TableHead",
            fontName=bold,
            fontSize=8.3,
            leading=12.4,
            textColor=colors.white,
            wordWrap="CJK",
        ),
        "callout": ParagraphStyle(
            "Callout",
            fontName=regular,
            fontSize=8.8,
            leading=14.2,
            textColor=TEXT,
            wordWrap="CJK",
        ),
        "caption": ParagraphStyle(
            "Caption",
            fontName=regular,
            fontSize=7.4,
            leading=10,
            textColor=MUTED,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
    }


def draw_page_frame(canvas, doc, page_number: int) -> None:
    width, height = A4
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.45)
    canvas.line(64, height - 45, width - 64, height - 45)
    canvas.setFont("ACTOManual", 7.3)
    canvas.setFillColor(MUTED)
    canvas.drawString(64, height - 35, "ACTO · CYCLE STUDIO")
    canvas.drawRightString(
        width - 64,
        height - 35,
        f"使用说明 | Version {VERSION}",
    )
    canvas.line(64, 38, width - 64, 38)
    canvas.setFont("ACTOManual", 7)
    canvas.drawString(64, 24, "Copyright: Agile Robot ISA Control")
    canvas.drawCentredString(
        width / 2,
        24,
        "联系人：xingchen.li@agile-robots.com",
    )
    canvas.drawRightString(width - 64, 24, f"{page_number:02d}")
    canvas.restoreState()


def callout(
    text: str,
    width: float,
    style: ParagraphStyle,
    fill: colors.Color = SOFT_BLUE,
    accent: colors.Color = BLUE,
) -> Table:
    table = Table(
        [["", Paragraph(text, style)]],
        colWidths=[4, width - 4],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BACKGROUND", (0, 0), (0, -1), accent),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#E2E8F2")),
                ("LEFTPADDING", (1, 0), (1, 0), 13),
                ("RIGHTPADDING", (1, 0), (1, 0), 13),
                ("TOPPADDING", (1, 0), (1, 0), 11),
                ("BOTTOMPADDING", (1, 0), (1, 0), 11),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return table


def make_metrics_table(styles: dict[str, ParagraphStyle], width: float) -> Table:
    rows = [
        ("指标", "含义与查看重点"),
        ("批次总时间", "最后完成动作的结束时间。越小表示批次节拍越短。"),
        (
            "平均 / 最短 CT",
            "平均 CT 为批次总时间除以重复次数；最短 CT 为实际循环间隔中的最小值。",
        ),
        ("并行重合", "多个执行单元同时工作的累计时间，用于判断并行收益。"),
        (
            "利用率情况",
            "列出全部执行单元的累计占用比例，并高亮利用率最高的瓶颈单元。",
        ),
        (
            "等待时间",
            "批次总时间减去各执行单元累计占用时间，包含未占用、依赖等待和资源等待。",
        ),
        ("约束满足", "显示当前排程是否满足全部依赖、资源不重叠和互斥约束。"),
    ]
    data = []
    for index, (label, description) in enumerate(rows):
        style = styles["table_head"] if index == 0 else styles["table"]
        data.append([Paragraph(label, style), Paragraph(description, style)])
    table = Table(data, colWidths=[width * 0.22, width * 0.78], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT_BLUE]),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return table


def build_replacement_page(output: Path) -> None:
    regular, bold = register_fonts()
    styles = make_styles(regular, bold)
    content_width = A4[0] - 128
    story = [
        Paragraph("SECTION 08", styles["section"]),
        Paragraph("运行排程与指标", styles["title"]),
        Paragraph(
            "完成动作和约束录入后，系统自动排程，也可以在顶部或甘特图工具栏点击"
            "“重新优化”。当前版本优先扩大甘特图，以更紧凑的方式展示关键指标。",
            styles["lead"],
        ),
        callout(
            "<b>当前界面策略</b> 顶部四个指标卡高度压缩至约 92px，并默认隐藏成功"
            "排程时的“排程洞察”和“并行窗口”。批次设置、指标卡和甘特图之间不再"
            "显示额外的成功提示栏，从而为动作甘特图释放更多垂直空间。",
            content_width,
            styles["callout"],
        ),
        Spacer(1, 12),
        make_metrics_table(styles, content_width),
        Spacer(1, 13),
        Paragraph("当前界面的指标显示规则", styles["h2"]),
        Paragraph(
            "利用率情况和等待时间采用可滚动列表。每张卡片可同时显示 4 行执行单元，"
            "完整显示执行单元名称、颜色标记和指标数值。",
            styles["body"],
        ),
        Paragraph(
            "执行单元数量超过 4 个时，将鼠标移到列表上滚动滚轮，可按行翻阅其余单元。",
            styles["bullet"],
            bulletText="•",
        ),
        Paragraph(
            "橙色行表示当前利用率最高的瓶颈单元；等待时间以批次总时间减去该单元的"
            "累计占用时间计算，包含空闲、依赖等待和资源等待。",
            styles["bullet"],
            bulletText="•",
        ),
        Paragraph(
            "平均 CT 和最短 CT 继续显示在“重复批次折算”区域，不重复占用顶部指标卡。",
            styles["bullet"],
            bulletText="•",
        ),
        Paragraph(
            "成功排程时当前版本不显示排程洞察与并行窗口明细。约束异常诊断不受影响，"
            "仍会在指标区下方列出错误原因和关联动作，并在修复后自动重新排程。",
            styles["bullet"],
            bulletText="•",
        ),
        Spacer(1, 5),
        Paragraph("推荐分析顺序", styles["h2"]),
        Paragraph(
            "先确认约束状态为“约束已满足”，记录批次总时间作为基线。",
            styles["bullet"],
            bulletText="•",
        ),
        Paragraph(
            "查看利用率与等待时间，识别瓶颈单元和主要空闲来源；必要时滚动列表"
            "查看全部执行单元。",
            styles["bullet"],
            bulletText="•",
        ),
        Paragraph(
            "调整动作顺序、并行关系或资源分配后重新优化，再比较并行重合、"
            "平均 CT 和最短 CT。",
            styles["bullet"],
            bulletText="•",
        ),
        Spacer(1, 3),
        callout(
            "<b>缓存机制</b> 输入没有变化时，重复优化会直接复用已缓存的排程结果；"
            "需要重新计算时，请先修改场景或清除手动调整。",
            content_width,
            styles["callout"],
            fill=SOFT_GREEN,
            accent=colors.HexColor("#27A37B"),
        ),
    ]

    doc = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=64,
        leftMargin=64,
        topMargin=59,
        bottomMargin=48,
        title="ACTO Cycle Studio 使用说明",
        author="Agile Robot ISA Control",
        subject=f"ACTO Cycle Studio Version {VERSION} 使用说明",
    )
    doc.build(
        story,
        onFirstPage=lambda canvas, document: draw_page_frame(
            canvas, document, TARGET_PAGE_INDEX + 1
        ),
    )
    if len(PdfReader(str(output)).pages) != 1:
        raise RuntimeError("更新页内容超出一页，请调整排版间距")


def replace_manual_page(replacement: Path, output: Path) -> None:
    reader = PdfReader(str(MANUAL_PATH))
    if len(reader.pages) != 14:
        raise RuntimeError(f"说明书页数异常：预期 14 页，实际 {len(reader.pages)} 页")

    new_page = PdfReader(str(replacement)).pages[0]
    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        writer.add_page(new_page if index == TARGET_PAGE_INDEX else page)

    timezone_china = timezone(timedelta(hours=8))
    modified = datetime.now(timezone_china)
    pdf_date = modified.strftime("D:%Y%m%d%H%M%S+08'00'")
    metadata = dict(reader.metadata or {})
    metadata.update(
        {
            "/Title": "ACTO Cycle Studio 使用说明",
            "/Author": "Agile Robot ISA Control",
            "/Subject": f"ACTO Cycle Studio Version {VERSION} 使用说明",
            "/ModDate": pdf_date,
        }
    )
    writer.add_metadata(metadata)

    with output.open("wb") as stream:
        writer.write(stream)


def main() -> None:
    if not MANUAL_PATH.is_file():
        raise FileNotFoundError(f"说明书不存在：{MANUAL_PATH}")

    with tempfile.TemporaryDirectory(prefix="acto-manual-") as temp_dir:
        temp_path = Path(temp_dir)
        replacement = temp_path / "metrics-page.pdf"
        merged = temp_path / "manual-updated.pdf"
        build_replacement_page(replacement)
        replace_manual_page(replacement, merged)
        os.replace(merged, MANUAL_PATH)

    updated = PdfReader(str(MANUAL_PATH))
    if len(updated.pages) != 14:
        raise RuntimeError("更新后的说明书页数不是 14 页")
    text = updated.pages[TARGET_PAGE_INDEX].extract_text() or ""
    required = ("4 行执行单元", "默认隐藏", "约束异常诊断")
    missing = [phrase for phrase in required if phrase not in text]
    if missing:
        raise RuntimeError(f"更新页缺少必要内容：{', '.join(missing)}")
    print(f"已更新说明书：{MANUAL_PATH}")


if __name__ == "__main__":
    main()
