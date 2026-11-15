#!/usr/bin/env python3
"""Generates sample EPUBs/PDFs for UI work: python3 scripts/make-sample-books.py <out-dir>
Then launch the app with those files as arguments to import them."""
import sys, zipfile, zlib, struct, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

def png(w, h, top, bottom):
    rows = b""
    for y in range(h):
        t = y / (h - 1)
        c = bytes(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        rows += b"\x00" + c * w
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")

LOREM = ("The lamps were being lit along the harbour as the ship came in. " * 12).strip()

def epub(name, title, authors, desc, cover=None, chapters=6):
    path = os.path.join(out, name)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        creators = "".join(f"<dc:creator>{a}</dc:creator>" for a in authors)
        items = "".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(chapters))
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(chapters))
        cov = '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>' if cover else ""
        z.writestr("OEBPS/content.opf", f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:uuid:{abs(hash(title))}</dc:identifier><dc:title>{title}</dc:title>{creators}<dc:language>en</dc:language><dc:description>{desc}</dc:description>
</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{cov}{items}</manifest><spine>{spine}</spine></package>''')
        z.writestr("OEBPS/nav.xhtml", '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol>' + "".join(f'<li><a href="c{i}.xhtml">Chapter {i+1}</a></li>' for i in range(chapters)) + '</ol></nav></body></html>')
        for i in range(chapters):
            paras = "".join(f"<p>{LOREM}</p>" for _ in range(8))
            z.writestr(f"OEBPS/c{i}.xhtml", f'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter {i+1}</title></head><body><h1>Chapter {i+1}</h1>{paras}</body></html>')
        if cover:
            z.writestr("OEBPS/cover.png", png(300, 450, *cover))

def pdf(name, title, author, pages):
    objs = []
    def add(s): objs.append(s); return len(objs)
    font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>")
    page_ids = []
    pages_id_placeholder = len(objs) + 1 + pages * 2
    for p in range(pages):
        lines = [f"BT /F1 28 Tf 72 700 Td ({title}) Tj ET", f"BT /F1 14 Tf 72 660 Td (Page {p+1} of {pages}) Tj ET"]
        for l in range(20):
            lines.append(f"BT /F1 11 Tf 72 {620 - l*24} Td (Line {l+1}: the quick brown fox jumps over the lazy dog.) Tj ET")
        stream = "\n".join(lines)
        c = add(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
        page_ids.append(add(f"<< /Type /Page /Parent {pages_id_placeholder} 0 R /MediaBox [0 0 612 792] /Contents {c} 0 R /Resources << /Font << /F1 {font} 0 R >> >> >>"))
    pages_id = add(f"<< /Type /Pages /Kids [{' '.join(f'{i} 0 R' for i in page_ids)}] /Count {pages} >>")
    assert pages_id == pages_id_placeholder
    cat = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>")
    info = add(f"<< /Title ({title}) /Author ({author}) /CreationDate (D:20210304120000Z) >>")
    body = b"%PDF-1.4\n"; offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(body)); body += f"{i} 0 obj\n{o}\nendobj\n".encode("latin-1")
    xref = len(body)
    body += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode() + "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    body += f"trailer\n<< /Size {len(objs)+1} /Root {cat} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    open(os.path.join(out, name), "wb").write(body)

epub("tides.epub", "The Cartographer of Tides", ["Mara Ellison"], "A mapmaker charts a coastline that will not stay still.", ((196, 120, 80), (60, 36, 40)))
epub("glass.epub", "A Field Guide to Glass Birds", ["Tomás Ibarra", "June Okafor"], "Essays on fragile things.", ((120, 160, 170), (24, 40, 56)))
epub("orchard.epub", "Orchard at the End of the World", ["Ursula K. Le Guin"], "No cover in this one — tests the placeholder.")
epub("quiet.epub", "The Quiet Hours", ["Elin Vass"], "Night shift stories.", ((210, 190, 140), (90, 70, 40)))
pdf("design_systems_handbook.pdf", "Design Systems Handbook", "R. Patel; S. Moreau", 12)
pdf("field-notes.pdf", "", "", 3)
print("ok")
