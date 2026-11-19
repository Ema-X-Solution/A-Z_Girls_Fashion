"""Use the skill rasterizer with a PDF exported by installed native Word."""
from pathlib import Path
import importlib.util
import os
ROOT=Path(__file__).resolve().parents[1]
runtime=Path(r'C:\Users\andkp\.cache\codex-runtimes\codex-primary-runtime')
os.environ['PATH']=str(runtime/'dependencies/native/poppler/Library/bin')+os.pathsep+os.environ['PATH']
skill=Path(r'C:\Users\andkp\.codex\plugins\cache\openai-primary-runtime\documents\26.1116.12020\skills\documents\render_docx.py')
spec=importlib.util.spec_from_file_location('document_renderer',skill)
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.convert_to_pdf=lambda *args,**kwargs:(str(ROOT/'output/pdf/AZ_Client_Manual_AR.pdf'),'Exported with installed Microsoft Word')
paths=module.rasterize(str(ROOT/'output/documents/AZ_Client_Manual_AR.docx'),str(ROOT/'.local/manual-qa'),120,False,False)
from pypdf import PdfReader
pdf=PdfReader(ROOT/'output/pdf/AZ_Client_Manual_AR.pdf')
print('Pages:',len(pdf.pages),'Rendered:',len(paths))
print('Text characters:',sum(len(p.extract_text()) for p in pdf.pages))
