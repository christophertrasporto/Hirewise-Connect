/**
 * Minimal single-page PDF writer (PDF 1.4, Helvetica) with no dependencies.
 * Enough for invoices and agreement receipts; a real layout engine can replace
 * it later without changing callers, which only pass lines of text.
 */
export type PdfLine = { text: string; bold?: boolean; size?: number; gap?: number };

function escapePdf(s: string): string {
  // WinAnsi only: replace anything outside Latin-1 so the file stays valid.
  return s
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function renderSimplePdf(lines: PdfLine[]): Buffer {
  const parts: string[] = [];
  let y = 800;
  for (const l of lines) {
    const size = l.size ?? 11;
    y -= (l.gap ?? 0) + size + 5;
    if (y < 40) break;
    parts.push(`BT /${l.bold ? "F2" : "F1"} ${size} Tf 50 ${y} Td (${escapePdf(l.text)}) Tj ET`);
  }
  const content = parts.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
