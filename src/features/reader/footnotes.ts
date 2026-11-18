/**
 * Footnotes, endnotes and citations in EPUBs.
 *
 * A link is treated as a note reference when the book says so (EPUB 3
 * `epub:type="noteref"`, ARIA `role="doc-noteref"`, and the citation and
 * glossary equivalents), or when it looks like one: a short marker such as
 * "12", "[3]", "*" or "†", often superscript, or a link whose classes or target
 * name it a footnote (Project Gutenberg's `fnanchor` → `#Footnote_1_1`).
 *
 * The note's text is copied out of the book through a whitelist of plain
 * formatting tags, never as raw HTML: book content is untrusted and the
 * popover lives in the app's own document.
 */

const OPS_NS = "http://www.idpf.org/2007/ops";

export type NoteKind = "note" | "citation";

function epubTypes(el: Element): string[] {
  const v = el.getAttribute("epub:type") ?? el.getAttributeNS(OPS_NS, "type") ?? "";
  return v.toLowerCase().split(/\s+/).filter(Boolean);
}

const roles = (el: Element) => (el.getAttribute("role") ?? "").toLowerCase().split(/\s+/);

const MARKER = /^[[(]?\s*([0-9]{1,4}[a-z]?|[ivxlcdm]{1,7}|[a-z]|[*†‡§¶‖#]{1,3})\s*[\])]?[.,]?$/i;
const NOTE_WORD = /(foot|endnote|note|fn|cite|citation|ref)/i;

/** Is this link a reference to a note? Returns what kind, or null for an ordinary link. */
export function noteKind(a: Element): NoteKind | null {
  const href = a.getAttribute("href") ?? "";
  if (!href.includes("#")) return null;
  const types = epubTypes(a);
  const role = roles(a);
  if (types.includes("biblioref") || role.includes("doc-biblioref")) return "citation";
  if (types.includes("noteref") || types.includes("glossref") || role.includes("doc-noteref") || role.includes("doc-glossref")) {
    return "note";
  }
  // Heuristics for books without semantics.
  if (types.length || role.some((r) => r.startsWith("doc-"))) return null;
  const text = (a.textContent ?? "").trim();
  const fragment = href.slice(href.indexOf("#") + 1);
  const classes = `${a.getAttribute("class") ?? ""} ${a.parentElement?.getAttribute("class") ?? ""}`;
  if (text.length > 0 && text.length <= 12 && (/\b(fn\w*|foot\w*|note\w*|endnote\w*)\b/i.test(classes) || NOTE_WORD.test(fragment))) {
    return "note";
  }
  const superscript = !!a.closest("sup") || !!a.querySelector("sup");
  if (text.length > 0 && text.length <= 6 && (superscript || MARKER.test(text))) return "note";
  return null;
}

/** The marker as the reader sees it: "12", "†". */
export function noteLabel(a: Element, kind: NoteKind): string {
  const marker = (a.textContent ?? "").trim().replace(/^[[(]\s*|\s*[\])][.,]?$/g, "");
  if (kind === "citation") return marker && marker.length <= 12 ? `Citation ${marker}` : "Citation";
  return marker ? `Note ${marker}` : "Note";
}

function findTarget(doc: Document, fragment: string): Element | null {
  if (!fragment) return null;
  const id = decodeURIComponent(fragment);
  return (
    doc.getElementById(id) ??
    doc.querySelector(`[id="${CSS.escape(id)}"]`) ??
    doc.querySelector(`[name="${CSS.escape(id)}"]`)
  );
}

const BLOCKS = new Set(["p", "div", "aside", "li", "dd", "section", "blockquote", "td", "footer"]);

function isNoteContainer(el: Element): boolean {
  const tag = el.localName;
  if (tag === "aside" || tag === "li" || tag === "dd") return true;
  if (epubTypes(el).some((t) => /^(footnote|endnote|rearnote|note|biblioentry|glossdef)$/.test(t))) return true;
  if (roles(el).some((r) => /^doc-(footnote|endnote|biblioentry)$/.test(r))) return true;
  return /\b(footnote|endnote|note|fn)\b/i.test(el.getAttribute("class") ?? "");
}

const textLength = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().length;

/**
 * The element holding the note that `target` (the link's destination) marks.
 * Usually the target itself or a note container around it; for a bare anchor
 * it's the paragraph it sits in, or the paragraphs after it.
 */
export function noteContainer(target: Element): Element[] {
  let el: Element | null = target;
  for (let depth = 0; el && depth < 6 && el.localName !== "body"; depth++, el = el.parentElement) {
    if (isNoteContainer(el) && textLength(el) < 6000) return [el];
  }
  // A bare anchor: the nearest block around it, if that has the note's text…
  let block: Element | null = target;
  while (block && !BLOCKS.has(block.localName) && block.localName !== "body") block = block.parentElement;
  if (block && block.localName !== "body" && textLength(block) > 2 && textLength(block) < 6000) return [block];
  // …or an empty anchor/heading followed by the note's paragraphs.
  const out: Element[] = [];
  for (let next = (block ?? target).nextElementSibling; next && out.length < 3; next = next.nextElementSibling) {
    if (out.length && (next.id || /^h[1-6]$/.test(next.localName))) break;
    out.push(next);
  }
  return out;
}

const KEEP = new Set(["p", "br", "em", "i", "strong", "b", "sup", "sub", "small", "cite", "q", "code", "ul", "ol", "li", "blockquote", "dl", "dt", "dd", "span", "u", "s"]);
const AS_PARAGRAPH = new Set(["div", "aside", "section", "footer", "td", "h1", "h2", "h3", "h4", "h5", "h6"]);
const DROP = new Set(["script", "style", "img", "svg", "math", "video", "audio", "iframe", "object", "embed", "head", "title", "link", "meta", "button", "input", "form", "table"]);

/**
 * Copies note content into `into` using only whitelisted tags and no attributes.
 * Back-links to the reference (and anything marked `doc-backlink`) are dropped.
 */
export function copyNote(nodes: Element[], into: HTMLElement, originId?: string) {
  const doc = into.ownerDocument;
  const isBacklink = (a: Element) => {
    if (roles(a).includes("doc-backlink") || epubTypes(a).includes("backlink")) return true;
    const href = a.getAttribute("href") ?? "";
    const frag = href.slice(href.indexOf("#") + 1);
    return (!!originId && href.includes("#") && decodeURIComponent(frag) === originId) || /^\s*(↩|↑|⤴|back)\s*$/i.test(a.textContent ?? "");
  };
  const walk = (src: Node, dest: Node) => {
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        dest.appendChild(doc.createTextNode(child.textContent ?? ""));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.localName.toLowerCase();
      if (DROP.has(tag)) continue;
      if (tag === "a") {
        if (isBacklink(el)) continue;
        walk(el, dest); // keep the text, not the link
        continue;
      }
      const out = KEEP.has(tag) ? doc.createElement(tag) : AS_PARAGRAPH.has(tag) ? doc.createElement("p") : null;
      if (out) {
        walk(el, out);
        if (out.textContent?.trim() || tag === "br") dest.appendChild(out);
      } else {
        walk(el, dest);
      }
    }
  };
  for (const node of nodes) {
    const wrapper = AS_PARAGRAPH.has(node.localName) || node.localName === "li" || node.localName === "dd" ? doc.createElement("p") : doc.createElement("div");
    walk(node, wrapper);
    if (wrapper.textContent?.trim()) into.appendChild(wrapper);
  }
  // A leading "[1]" / "1." that just repeats the marker.
  const first = into.firstElementChild;
  const lead = first?.firstChild;
  if (lead?.nodeType === Node.TEXT_NODE) lead.textContent = (lead.textContent ?? "").replace(/^\s*[[(]?\s*[0-9*†‡§]{1,4}\s*[\]).]?\s+/, "");
}

/** `notes.xhtml#n3` relative to `chapters/ch1.xhtml` → `{ path: "chapters/notes.xhtml", fragment: "n3" }`. */
export function resolveHref(href: string, from: string): { path: string; fragment: string } {
  const url = new URL(href, `https://book.invalid/${from}`);
  return { path: decodeURIComponent(url.pathname.slice(1)), fragment: url.hash.slice(1) };
}

export { findTarget };
