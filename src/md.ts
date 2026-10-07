// Minimal markdown for the extracted Hero Kids text: headings, read-aloud
// blockquotes, bullet lists and paragraphs.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\b(difficulty \d)\b/gi, "<mark>$1</mark>");
  t = t.replace(/\b(Encounter \d+)\b/g, "<b>$1</b>");
  return t;
}

export interface MdOptions {
  /** Add a "show to players" button to each read-aloud block. */
  shareButtons?: boolean;
  /** Drop these level-2 headings (rendered elsewhere). */
  skipSections?: string[];
}

export function renderMarkdown(md: string, opts: MdOptions = {}): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let list = false;
  let quote: string[] = [];
  let skipping = false;
  let readIdx = 0;
  const flushQuote = () => {
    if (!quote.length) return;
    const paras = quote.join("\n").split(/\n\s*\n|\n(?=>)/).map((p) => p.trim()).filter(Boolean);
    const body = paras.map((p) => `<p>${inline(p)}</p>`).join("");
    const btn = opts.shareButtons
      ? `<button class="share" data-read="${readIdx}" title="Show this text on the players' screens">Show players</button>`
      : "";
    out.push(`<blockquote class="read" data-read="${readIdx}">${btn}${body}</blockquote>`);
    readIdx++;
    quote = [];
  };
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h && h[1].length === 2) skipping = !!opts.skipSections?.includes(h[2].trim());
    if (h && h[1].length === 1) skipping = false;
    if (skipping) continue;
    if (line.startsWith(">")) {
      closeList();
      const t = line.replace(/^>\s?/, "");
      quote.push(t === "" ? "" : t);
      continue;
    }
    flushQuote();
    if (h) {
      closeList();
      const lvl = h[1].length + 1;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    } else if (/^- /.test(line)) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flushQuote();
  closeList();
  return out.join("\n");
}

/** Pull one "## Heading" section out of an encounter's markdown. */
export function section(md: string, heading: string): string {
  const m = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(md);
  return m ? m[1].trim() : "";
}

export { esc };
