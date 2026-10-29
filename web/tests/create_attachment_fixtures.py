"""Create fictional files for local attachment UI checks; no user documents are read."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

folder = Path(__file__).parent / "fixtures"
folder.mkdir(exist_ok=True)
text = "附件验收样例（完全虚构）\n项目：校园节能分析\nPython English 数据整理\n<img src=x onerror=alert(1)> 这段应以普通文字显示。\n"
(folder / "虚构项目说明.txt").write_text(text, encoding="utf-8")
(folder / "虚构研究计划.md").write_text("# 虚构研究计划\n\n- 整理数据\n- 编写分析报告\n", encoding="utf-8")
(folder / "无效文件.pdf").write_text("This is not a PDF file", encoding="utf-8")
(folder / "空文件.txt").write_bytes(b"")

font_path = "C:/Windows/Fonts/simsun.ttc"
pdfmetrics.registerFont(TTFont("FixtureChinese", font_path))
pdf = canvas.Canvas(str(folder / "虚构成果报告.pdf"), pagesize=(595.28, 841.89))
pdf.setTitle("Fictional attachment QA sample")
pdf.setFont("FixtureChinese", 20)
pdf.drawString(55, 765, "虚构成果报告")
pdf.setFont("FixtureChinese", 12)
for index, line in enumerate(["仅用于附件保存、预览和下载验收。", "项目：校园节能分析（虚构）", "成果：形成示例分析报告。", "No personal information. Fictional fixture only."]):
    pdf.drawString(55, 715 - index * 30, line)
pdf.showPage()
pdf.save()

image = Image.new("RGB", (720, 450), "#faf7ee")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((25, 25, 695, 425), radius=18, outline="#cdb16c", width=4)
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 32)
small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
draw.text((85, 125), "虚构证明图片 · 附件检查", font=font, fill="#494539")
draw.text((85, 215), "无真实身份、证件号码或个人信息", font=small, fill="#6c675d")
image.save(folder / "虚构证明图片.png")

# Minimal standard OOXML package, for storage/download only (no extraction in this step).
with ZipFile(folder / "虚构项目材料.docx", "w", ZIP_DEFLATED) as package:
    package.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    package.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    package.writestr("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>虚构项目材料，仅用于附件下载验收。</w:t></w:r></w:p></w:body></w:document>')
print("Created fictional UI fixtures:", folder)
