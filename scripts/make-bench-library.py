#!/usr/bin/env python3
"""Generates a large synthetic library for performance testing.

    python3 scripts/make-bench-library.py <out-dir> [count] [cover.jpg]

Each EPUB has a full-size cover (like real-world books), which is what stresses
memory in grid views. Pass a JPEG to use as the cover; otherwise a tiny one is used.
"""
import os, sys, zipfile

out = sys.argv[1]
count = int(sys.argv[2]) if len(sys.argv) > 2 else 600
cover = open(sys.argv[3], "rb").read() if len(sys.argv) > 3 else None
os.makedirs(out, exist_ok=True)

WORDS = "amber harbor lantern meridian orchard quiet signal tide winter vellum ember atlas".split()
P = "<p>" + ("The lamps were being lit along the harbour as the ship came in. " * 10) + "</p>"

for i in range(count):
    title = f"{WORDS[i % len(WORDS)].title()} {WORDS[(i * 7) % len(WORDS)].title()} No. {i + 1}"
    author = f"Author {i % 97}"
    path = os.path.join(out, f"bench-{i:04d}.epub")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        cov = '<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>' if cover else ""
        z.writestr("OEBPS/content.opf", f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">bench-{i}</dc:identifier><dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:language>en</dc:language>
<dc:description>{"A synthetic book for benchmarking. " * 20}</dc:description></metadata>
<manifest>{cov}<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>''')
        z.writestr("OEBPS/c1.xhtml", f'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><h1>{title}</h1>{P * 20}</body></html>')
        if cover:
            z.writestr("OEBPS/cover.jpg", cover)
print(f"wrote {count} books to {out}")
