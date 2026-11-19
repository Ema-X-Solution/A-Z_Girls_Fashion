from pathlib import Path
import re
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/documents/AZ_Client_Manual_AR.docx'
OUT.parent.mkdir(parents=True, exist_ok=True)
doc = Document()
sec = doc.sections[0]
sec.page_height, sec.page_width = Cm(29.7), Cm(21)
sec.top_margin = sec.bottom_margin = Cm(1.8)
sec.left_margin = sec.right_margin = Cm(2)
sec.header_distance = sec.footer_distance = Cm(.8)
sec.different_first_page_header_footer = True

def rtl(p):
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    ppr = p._p.get_or_add_pPr()
    e = OxmlElement('w:bidi'); e.set(qn('w:val'), '1'); ppr.append(e)

for name, size in [('Normal',11),('Title',28),('Heading 1',18),('Heading 2',14),('TOC 1',10)]:
    try: s = doc.styles[name]
    except KeyError: s = doc.styles.add_style(name,1)
    s.font.name = 'Arial'; s.font.size = Pt(size); s.font.color.rgb = RGBColor(0,0,0)
    rpr = s.element.get_or_add_rPr()
    rf = OxmlElement('w:rFonts'); rf.set(qn('w:cs'),'Arial'); rpr.append(rf)
    sz = OxmlElement('w:szCs'); sz.set(qn('w:val'),str(size*2)); rpr.append(sz)
    s.paragraph_format.space_after = Pt(7)
    s.paragraph_format.line_spacing = 1.18
    if name.startswith('Heading'): s.paragraph_format.keep_with_next = True
    spr=s.element.get_or_add_pPr()
    b=OxmlElement('w:bidi'); b.set(qn('w:val'),'1'); spr.append(b)
    for border in list(spr.findall(qn('w:pBdr'))): spr.remove(border)
    if name=='TOC 1':
        s.paragraph_format.space_after=Pt(0)
        s.paragraph_format.line_spacing=.95
        s.paragraph_format.alignment=WD_ALIGN_PARAGRAPH.LEFT

for s in doc.styles:
    for border in list(s.element.iter(qn('w:pBdr'))): border.getparent().remove(border)

def addtext(p, text):
    for i, part in enumerate(re.split(r'(\*\*.*?\*\*)',text)):
        if not part: continue
        bold = part.startswith('**') and part.endswith('**')
        r = p.add_run(part[2:-2] if bold else part); r.bold = bold
        rpr=r._r.get_or_add_rPr(); lang=OxmlElement('w:lang'); lang.set(qn('w:bidi'),'ar-EG'); rpr.append(lang)
        if re.search(r'[\u0600-\u06ff]',part):
            e=OxmlElement('w:rtl'); e.set(qn('w:val'),'1'); rpr.append(e)
        rf=OxmlElement('w:rFonts'); rf.set(qn('w:cs'),'Arial'); rf.set(qn('w:ascii'),'Arial'); rf.set(qn('w:hAnsi'),'Arial'); rpr.append(rf)
    return p

def para(text='',style=None):
    p=doc.add_paragraph(style=style); rtl(p); addtext(p,text); return p

logo=ROOT/'apps/web/public/brand/az-logo.jpg'
if logo.exists():
    p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(logo),width=Cm(4.4))
p=para('دليل تشغيل وإدارة المتجر','Title'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
p=doc.add_paragraph('A&Z Girls Fashion'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
p.runs[0].font.size=Pt(20)
for text in ['دليل المستخدم والإدارة والتشغيل اليومي','للمالك والمدير والكاشير ومسؤول المخزون','الإصدار ١٫٠ | ١٨ نوفمبر ٢٠٢٦']:
    p=para(text); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
para('من تجهيز الأصناف واستلام البضاعة إلى البيع والتحصيل والمرتجعات وإغلاق الوردية ومراجعة الحسابات.')
para('يشمل خطوات العمل والأمثلة وقواعد الحسابات وحلول المشكلات وقائمة التجهيز للتشغيل الفعلي وحدود النسخة الحالية.')
doc.add_page_break()
p=para('محتويات الدليل'); p.runs[0].font.size=Pt(18); p.runs[0].bold=True
p=para(); fld=OxmlElement('w:fldSimple'); fld.set(qn('w:instr'),'TOC \\o "1-1" \\h \\z \\u'); p._p.append(fld)
doc.add_page_break()

lines=(ROOT/'docs/client/AZ_CLIENT_MANUAL_AR.md').read_text(encoding='utf-8').splitlines()
i=0
while i<len(lines):
    line=lines[i].strip(); i+=1
    if not line or line.startswith('# '): continue
    if line.startswith('|'):
        rows=[]
        while True:
            if not re.fullmatch(r'[| :\-]+',line): rows.append([x.strip() for x in line.strip('|').split('|')])
            if i>=len(lines) or not lines[i].strip().startswith('|'): break
            line=lines[i].strip(); i+=1
        n=len(rows[0]); table=doc.add_table(rows=0,cols=n); table.autofit=False
        widths=([5.2,11.8] if n==2 else [4.2,5.2,7.6] if n==3 else [17/n]*n)
        pr=table._tbl.tblPr
        bidi=OxmlElement('w:bidiVisual'); pr.append(bidi)
        borders=OxmlElement('w:tblBorders')
        for edge in ['top','left','bottom','right','insideH','insideV']:
            el=OxmlElement('w:'+edge); el.set(qn('w:val'),'single'); el.set(qn('w:sz'),'4'); el.set(qn('w:color'),'D9D9D9'); borders.append(el)
        pr.append(borders)
        for ri,row in enumerate(rows):
            tr=table.add_row()
            if ri==0: tr._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
            for ci,txt in enumerate(row):
                cell=tr.cells[ci]; cell.width=Cm(widths[ci]); tcpr=cell._tc.get_or_add_tcPr()
                shade=OxmlElement('w:shd'); shade.set(qn('w:fill'),'303030' if ri==0 else 'F5F5F5' if ri%2 else 'FFFFFF'); tcpr.append(shade)
                margins=OxmlElement('w:tcMar')
                for edge in ['top','left','bottom','right']:
                    e=OxmlElement('w:'+edge); e.set(qn('w:w'),'100'); e.set(qn('w:type'),'dxa'); margins.append(e)
                tcpr.append(margins)
                p=cell.paragraphs[0]; rtl(p); addtext(p,txt); p.paragraph_format.space_after=Pt(3)
                for r in p.runs:
                    r.font.size=Pt(10)
                    if ri==0: r.bold=True; r.font.color.rgb=RGBColor(255,255,255)
        para()
    elif line.startswith('### '): para(line[4:],'Heading 2')
    elif line.startswith('## '): para(line[3:],'Heading 1')
    elif line=='---': continue
    else: para(line)

p=sec.header.paragraphs[0]; rtl(p); addtext(p,'دليل تشغيل وإدارة المتجر'); p.runs[0].font.size=Pt(9)
p=sec.footer.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER
e=OxmlElement('w:bidi'); e.set(qn('w:val'),'0'); p._p.get_or_add_pPr().append(e)
p.add_run('A&Z Girls Fashion  •  ')
for field in ['PAGE','NUMPAGES']:
    e=OxmlElement('w:fldSimple'); e.set(qn('w:instr'),field); p._p.append(e)
    if field=='PAGE': p.add_run(' / ')
doc.core_properties.title='دليل تشغيل وإدارة متجر A&Z Girls Fashion'
doc.core_properties.subject='دليل العميل والتشغيل اليومي وحدود النسخة الحالية'
doc.core_properties.author='A&Z Girls Fashion'
doc.save(OUT)
print(OUT)
