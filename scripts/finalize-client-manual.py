from pathlib import Path
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from copy import deepcopy
import re
root=Path(__file__).resolve().parents[1]
path=root/'output/documents/AZ_Client_Manual_AR.docx'
d=Document(path)
for tr in d.element.iter(qn('w:tr')):
    pr=tr.find(qn('w:trPr'))
    if pr is None:pr=OxmlElement('w:trPr');tr.insert(0,pr)
    if pr.find(qn('w:cantSplit')) is None:pr.append(OxmlElement('w:cantSplit'))
pattern=re.compile(r"([A-Za-z0-9][A-Za-z0-9 &@#_+./:\\%=()'\-]*[A-Za-z0-9/]|[A-Za-z0-9])")
for r in list(d.element.iter(qn('w:r'))):
    ts=r.findall(qn('w:t'))
    if len(ts)!=1 or not re.search(r'[\u0600-\u06ff]',ts[0].text or ''):continue
    text=ts[0].text or ''
    if not re.search(r'[A-Za-z0-9]',text):continue
    parent=r.getparent(); idx=parent.index(r)
    for part in pattern.split(text):
        if not part:continue
        nr=OxmlElement('w:r'); props=r.find(qn('w:rPr'))
        rp=deepcopy(props) if props is not None else OxmlElement('w:rPr')
        for el in list(rp.findall(qn('w:rtl'))):rp.remove(el)
        direction=OxmlElement('w:rtl'); direction.set(qn('w:val'),'1' if re.search(r'[\u0600-\u06ff]',part) else '0'); rp.append(direction)
        nr.append(rp); t=OxmlElement('w:t'); t.set(qn('xml:space'),'preserve'); t.text=part;nr.append(t)
        parent.insert(idx,nr);idx+=1
    parent.remove(r)
for p in d.paragraphs:
    if p.style.name.lower().replace(' ','')=='toc1':
        p.paragraph_format.line_spacing=Pt(14)
        p.paragraph_format.space_before=Pt(0)
        p.paragraph_format.space_after=Pt(0)
    if any(b.get(qn('w:type'))=='page' for b in p._p.iter(qn('w:br'))):
        p.paragraph_format.space_after=Pt(0)
        p.paragraph_format.space_before=Pt(0)
        p.paragraph_format.line_spacing=Pt(1)
        for r in p.runs:r.font.size=Pt(1)
d.save(path)
print('Compacted contents and page breaks')
