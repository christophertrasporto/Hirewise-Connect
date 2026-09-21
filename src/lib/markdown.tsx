import type { ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for agreement bodies: headings, block quotes,
 * bullet lists, paragraphs. No raw HTML is ever interpreted.
 */
export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(<p key={key++} className="text-[15px] leading-relaxed text-ink-600">{para.join(" ")}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-ink-600">
          {list.map((item, i) => <li key={i}>{item}</li>)}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushPara(); flushList();
      out.push(<h2 key={key++} className="text-[22px] font-bold text-ink-900">{line.slice(2)}</h2>);
    } else if (line.startsWith("## ")) {
      flushPara(); flushList();
      out.push(<h3 key={key++} className="mt-4 text-[16px] font-bold text-ink-900">{line.slice(3)}</h3>);
    } else if (line.startsWith("> ")) {
      flushPara(); flushList();
      out.push(<blockquote key={key++} className="rounded-xl border border-gold-200 bg-gold-50 px-3.5 py-2.5 text-[13.5px] text-gold-700">{line.slice(2)}</blockquote>);
    } else if (/^[-*] /.test(line)) {
      flushPara();
      list.push(line.slice(2));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out;
}
