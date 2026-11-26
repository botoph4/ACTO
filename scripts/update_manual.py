#!/usr/bin/env python3
"""Regenerate the ACTO manual's scheduling metrics page and replace it in-place."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph,
    Image,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
MANUAL_PATH = ROOT / "docs" / "ACTO-Cycle-Studio-使用说明.pdf"
MANUAL_SOURCE_PATH = Path(
    os.environ.get("ACTO_MANUAL_SOURCE", str(MANUAL_PATH))
).expanduser()
MANUAL_OUTPUT_PATH = Path(
    os.environ.get("ACTO_MANUAL_OUTPUT", str(MANUAL_PATH))
).expanduser()
TARGET_PAGE_INDEX = 9
WORKSHEET_PAGE_INDEX = 5
REPEAT_PAGE_INDEX = 8
FAQ_PAGE_INDEX = 12
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
            "平均 CT = 批次总时间 ÷ 总次数。最短 CT 按选定范围计算；2 次以内不显示，3 次取第 1→2 次，4 次以上排除首尾循环。",
        ),
        ("并行重合", "多个执行单元同时工作的累计时间，用于判断并行收益。"),
        (
            "利用率情况",
            "只统计执行单元自身承担的动作时长，不计其他动作的附加占用，并高亮最高利用率单元。",
        ),
        (
            "等待时间",
            "批次总时间减去执行单元自身承担的动作时长，包含未占用、依赖等待和资源等待。",
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


def single_page_document(output: Path, story: list, page_number: int) -> None:
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
            canvas, document, page_number
        ),
    )
    if len(PdfReader(str(output)).pages) != 1:
        raise RuntimeError(f"第 {page_number} 页内容超出一页，请调整排版间距")


def build_metrics_page(output: Path) -> None:
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
            "橙色行表示当前利用率最高的瓶颈单元；等待时间以批次总时间减去该单元"
            "自身承担的动作时长计算，包含空闲、依赖等待和资源等待。",
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

    single_page_document(output, story, TARGET_PAGE_INDEX + 1)


def build_worksheet_page(output: Path) -> None:
    regular, bold = register_fonts()
    styles = make_styles(regular, bold)
    content_width = A4[0] - 128
    screenshot_path = ROOT / "docs" / "acto-worksheet-switcher.png"
    screenshot = Image(
        str(screenshot_path),
        width=content_width,
        height=content_width / (2520 / 1287),
    )
    compact_bullet = ParagraphStyle(
        "CompactBullet",
        parent=styles["bullet"],
        fontSize=8.7,
        leading=14,
        spaceAfter=4,
    )
    story = [
        Paragraph("SECTION 04", styles["section"]),
        Paragraph("工作表管理", styles["title"]),
        Paragraph(
            "工作表用于隔离不同机器人、工位或方案的场景数据。每名用户可以在自己的"
            "工作表中自由切换，并直接维护当前场景的名称、说明和标签。",
            styles["lead"],
        ),
        screenshot,
        Paragraph(
            "图 4-1 工作表切换菜单与当前场景信息区。",
            styles["caption"],
        ),
        Spacer(1, 10),
        Paragraph("场景信息编辑", styles["h2"]),
        Paragraph(
            "当前场景标题和说明可直接在左侧信息区点击编辑，修改后自动保存；"
            "标题会同步到对应的工作表名称。",
            compact_bullet,
            bulletText="•",
        ),
        Paragraph(
            "标签支持直接改名，点击标签右侧的 X 可删除，点击“+ 标签”可新增。"
            "标签随场景 JSON 一起保存和导入导出。",
            compact_bullet,
            bulletText="•",
        ),
        Paragraph(
            "工作表栏支持新建、切换、重命名、复制和删除。双击工作表标签也可快速"
            "重命名。",
            compact_bullet,
            bulletText="•",
        ),
        Spacer(1, 4),
        callout(
            "<b>保存机制</b> 场景信息和工作表会自动保存到当前账号对应的浏览器"
            "本地存储。更换电脑或清理浏览器数据前，请先使用“导出全部工作表”"
            "保留 JSON 备份。",
            content_width,
            styles["callout"],
        ),
    ]
    single_page_document(output, story, WORKSHEET_PAGE_INDEX + 1)


def build_repeat_page(output: Path) -> None:
    regular, bold = register_fonts()
    styles = make_styles(regular, bold)
    content_width = A4[0] - 128
    screenshot = Image(
        str(ROOT / "docs" / "acto-repeat-summary.png"),
        width=content_width,
        height=content_width / (1680 / 858),
    )
    compact_bullet = ParagraphStyle(
        "RepeatCompactBullet",
        parent=styles["bullet"],
        fontSize=8.8,
        leading=14,
        spaceAfter=4,
    )
    story = [
        Paragraph("SECTION 07", styles["section"]),
        Paragraph("重复次数与循环边界", styles["title"]),
        Paragraph(
            "重复次数用于评估批量生产。动作模板只维护一份，求解器会展开对应轮次，"
            "最短 CT 统计范围可与排程循环边界分开设置。甘特图循环标签仅显示该次 CT "
            "起点动作的时间戳。",
            styles["lead"],
        ),
        screenshot,
        Paragraph(
            "图 7-1 循环序号及起始时间标注在每次循环边界虚线的上方。",
            styles["caption"],
        ),
        Spacer(1, 9),
        Paragraph("平均 CT 与最短 CT", styles["h2"]),
        Paragraph(
            "平均 CT 固定为批次总时间除以总次数，不受自定义 CT 统计范围变化影响。",
            compact_bullet,
            bulletText="•",
        ),
        Paragraph(
            "CT 起点与终点不同时，每次 CT = 终点动作结束时间 - 起点动作开始时间；"
            "统计时排除首尾循环。",
            compact_bullet,
            bulletText="•",
        ),
        Paragraph(
            "起点和终点为同一动作时，1-2 次不显示最短 CT；3 次取第 1→2 次间隔；"
            "4 次以上排除首尾循环，取中间稳定区间。",
            compact_bullet,
            bulletText="•",
        ),
        Paragraph(
            "平均 CT 和最短 CT 分两行显示。点击结果后的问号图标可查看计算说明，"
            "鼠标悬停也会显示说明。利用率仅按主执行单元动作计算。",
            compact_bullet,
            bulletText="•",
        ),
        Spacer(1, 4),
        callout(
            "<b>高重复批次</b> 单次求解上限为 60 秒，CP-SAT 会并行搜索并以默认 "
            "1% 相对间隙优先保证响应速度。若仍提示求解超时，请先降低重复次数完成"
            "单循环和稳态节拍分析。",
            content_width,
            styles["callout"],
            fill=SOFT_WARM,
            accent=colors.HexColor("#D89543"),
        ),
    ]
    single_page_document(output, story, REPEAT_PAGE_INDEX + 1)


def build_faq_page(output: Path) -> None:
    regular, bold = register_fonts()
    styles = make_styles(regular, bold)
    content_width = A4[0] - 128
    rows = [
        ("问题", "处理方法"),
        ("页面打不开", "确认已连接公司局域网，再访问 http://10.8.1.106:18090 。"),
        ("账号或密码错误", "检查大小写和输入法；仍无法登录时联系管理员创建或重置账号。"),
        ("刷新后工作表仍在吗", "在当前浏览器和当前账号下会自动保存；清理浏览器数据前先导出 JSON。"),
        ("切换电脑后没有工作表", "请使用“全部工作表 JSON”迁移。"),
        ("显示约束异常", "查看异常面板中的标题和关联动作，常见原因是依赖闭环或引用失效。"),
        (
            "重复次数很高时报错",
            "单次求解上限为 60 秒。若提示“求解超时”，先降低重复次数完成单循环分析。",
        ),
        ("PNG 中没有依赖线", "确认甘特图工具栏的“依赖线”处于开启状态，再重新导出。"),
    ]
    data = []
    for index, (question, answer) in enumerate(rows):
        style = styles["table_head"] if index == 0 else styles["table"]
        data.append([Paragraph(question, style), Paragraph(answer, style)])
    faq = Table(data, colWidths=[content_width * 0.27, content_width * 0.73])
    faq.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT_BLUE]),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story = [
        Paragraph("SECTION 11", styles["section"]),
        Paragraph("常见问题", styles["title"]),
        Paragraph(
            "以下问题覆盖登录、保存、排程和结果解读。遇到异常时先记录错误标题"
            "和关联动作。",
            styles["lead"],
        ),
        faq,
        Spacer(1, 14),
        callout(
            "<b>反馈问题时请提供</b> 当前工作表名称、重复次数、错误标题、关联动作"
            "编号，以及导出的场景 JSON。",
            content_width,
            styles["callout"],
        ),
    ]
    single_page_document(output, story, FAQ_PAGE_INDEX + 1)


def merge_screenshot(
    page,
    image_path: Path,
    x: float,
    y: float,
    width: float,
    height: float,
) -> None:
    packet = BytesIO()
    overlay = pdf_canvas.Canvas(packet, pagesize=A4)
    overlay.setFillColor(colors.white)
    overlay.rect(x - 1, y - 1, width + 2, height + 2, fill=1, stroke=0)
    overlay.drawImage(
        str(image_path),
        x,
        y,
        width=width,
        height=height,
        preserveAspectRatio=False,
        mask="auto",
    )
    overlay.showPage()
    overlay.save()
    packet.seek(0)
    page.merge_page(PdfReader(packet).pages[0], over=True)


def replace_manual_page(replacement: Path, output: Path) -> None:
    reader = PdfReader(str(MANUAL_SOURCE_PATH))
    if len(reader.pages) != 14:
        raise RuntimeError(f"说明书页数异常：预期 14 页，实际 {len(reader.pages)} 页")

    replacements = PdfReader(str(replacement))
    replacement_pages = {
        WORKSHEET_PAGE_INDEX: replacements.pages[0],
        REPEAT_PAGE_INDEX: replacements.pages[1],
        TARGET_PAGE_INDEX: replacements.pages[2],
        FAQ_PAGE_INDEX: replacements.pages[3],
    }
    screenshot_updates = {
        4: ("acto-preview.png", 51.02362, 423.5452, 493.2283, 251.817),
        6: (
            "acto-loop-boundaries-in-list.png",
            51.02362,
            86.18225,
            493.2283,
            283.98,
        ),
        10: ("acto-gantt-drag.png", 51.02362, 443.5452, 493.2283, 251.817),
        11: ("acto-import-dialog.png", 51.02362, 443.5452, 493.2283, 251.817),
    }
    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if index in screenshot_updates:
            image_name, x, y, width, height = screenshot_updates[index]
            merge_screenshot(
                page,
                ROOT / "docs" / image_name,
                x,
                y,
                width,
                height,
            )
        writer.add_page(replacement_pages.get(index, page))

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
    if not MANUAL_SOURCE_PATH.is_file():
        raise FileNotFoundError(f"说明书底稿不存在：{MANUAL_SOURCE_PATH}")
    if not MANUAL_OUTPUT_PATH.parent.is_dir():
        raise FileNotFoundError(f"说明书输出目录不存在：{MANUAL_OUTPUT_PATH.parent}")

    with tempfile.TemporaryDirectory(prefix="acto-manual-") as temp_dir:
        temp_path = Path(temp_dir)
        worksheet_page = temp_path / "worksheet-page.pdf"
        repeat_page = temp_path / "repeat-page.pdf"
        metrics_page = temp_path / "metrics-page.pdf"
        faq_page = temp_path / "faq-page.pdf"
        replacement = temp_path / "replacement-pages.pdf"
        merged = temp_path / "manual-updated.pdf"
        build_worksheet_page(worksheet_page)
        build_repeat_page(repeat_page)
        build_metrics_page(metrics_page)
        build_faq_page(faq_page)
        replacement_writer = PdfWriter()
        replacement_writer.add_page(PdfReader(str(worksheet_page)).pages[0])
        replacement_writer.add_page(PdfReader(str(repeat_page)).pages[0])
        replacement_writer.add_page(PdfReader(str(metrics_page)).pages[0])
        replacement_writer.add_page(PdfReader(str(faq_page)).pages[0])
        with replacement.open("wb") as stream:
            replacement_writer.write(stream)
        replace_manual_page(replacement, merged)
        os.replace(merged, MANUAL_OUTPUT_PATH)

    updated = PdfReader(str(MANUAL_OUTPUT_PATH))
    if len(updated.pages) != 14:
        raise RuntimeError("更新后的说明书页数不是 14 页")
    text = updated.pages[TARGET_PAGE_INDEX].extract_text() or ""
    required = ("4 行执行单元", "默认隐藏", "约束异常诊断")
    missing = [phrase for phrase in required if phrase not in text]
    if missing:
        raise RuntimeError(f"更新页缺少必要内容：{', '.join(missing)}")
    repeat_text = updated.pages[REPEAT_PAGE_INDEX].extract_text() or ""
    repeat_required = (
        "平均 CT 固定",
        "1-2 次不显示",
        "3 次取第 1→2 次间隔",
        "问号图标",
        "60 秒",
        "时间戳",
    )
    repeat_missing = [
        phrase for phrase in repeat_required if phrase not in repeat_text
    ]
    if repeat_missing:
        raise RuntimeError(
            f"重复批次页缺少必要内容：{', '.join(repeat_missing)}"
        )
    print(f"已更新说明书：{MANUAL_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
