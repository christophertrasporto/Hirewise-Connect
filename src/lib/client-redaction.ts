/**
 * Client-facing text redaction (v2 phase 5, decision 2 and feature 9). Pure and testable.
 * Removes contact routes from free text before it reaches a client and replaces known agency names with the
 * Partner Team name. Deliberately over-inclusive: a redacted token reads "[removed]"; nothing is ever dropped silently.
 */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ph|me|link|app|dev|info|biz|us|uk|au|ca|ai|xyz|site|online)\b(?:\/[^\s<>"')\]]*)?/gi;
const HANDLE = /(?<![\w.])@[a-z0-9_.]{3,}/gi;
const MESSAGING_HINT = /\b(?:whatsapp|telegram|skype|viber|signal|discord|wechat|line id|facebook|fb|instagram|ig|linkedin)\b[\s:#-]*(?:id|handle|number|me|at)?[\s:#-]*[\w.+-]{3,}/gi;
// 7+ digits with optional separators; years and short ids are protected before matching.
const PHONE = /(?<![\w/])\+?\d[\d\s().-]{6,}\d(?![\w/])/g;
const YEAR = /\b(?:19|20)\d{2}\b/g;

export type Redaction = { text: string; findings: string[] };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Redacts contact details and agency names from one piece of free text.
 * `agencyNames` maps a real agency name to what the client may see instead.
 */
export function redactForClient(input: string | null | undefined, opts: { agencyNames?: Array<{ name: string; replacement: string }> } = {}): Redaction {
  if (!input) return { text: input ?? "", findings: [] };
  const findings = new Set<string>();
  let text = input.normalize("NFKC");
  const mark = (re: RegExp, label: string) => {
    text = text.replace(re, () => {
      findings.add(label);
      return "[removed]";
    });
  };
  mark(EMAIL, "email address");
  mark(URL, "link");
  mark(BARE_DOMAIN, "link");
  mark(MESSAGING_HINT, "messaging handle");
  mark(HANDLE, "social handle");
  // Phones: blank out years first so "2019 to 2023" survives, then restore the original text where nothing matched.
  const protectedText = text.replace(YEAR, (m) => "\u0000".repeat(m.length));
  let out = "";
  let last = 0;
  for (const m of protectedText.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 7) continue;
    out += text.slice(last, m.index) + "[removed]";
    last = (m.index ?? 0) + m[0].length;
    findings.add("phone number");
  }
  text = out + text.slice(last);
  for (const a of opts.agencyNames ?? []) {
    const name = a.name.trim();
    if (name.length < 3) continue;
    const re = new RegExp(escapeRe(name), "gi");
    if (re.test(text)) {
      findings.add("agency name");
      text = text.replace(re, a.replacement);
    }
  }
  return { text, findings: [...findings] };
}

/** True when the text would change under redaction (used to decide whether a document needs a reviewer). */
export function containsContactDetails(input: string | null | undefined, agencyNames: Array<{ name: string; replacement: string }> = []): string[] {
  return redactForClient(input, { agencyNames }).findings;
}

/** "Maria Santos Cruz" -> "Maria C."; a single word stays as is. */
export function clientLabelFrom(fullName: string | null | undefined, fallback: string): string {
  const parts = (fullName?.trim() || fallback).normalize("NFKC").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Masked client label for talent who have no CLIENT_IDENTITY grant: "Healthcare client, United States". */
export function maskedClientLabel(c: { industry: string | null; country: string | null }): string {
  const industry = c.industry?.trim();
  const country = c.country?.trim();
  const head = industry ? `${industry} client` : "Client";
  return country ? `${head}, ${country}` : head;
}
