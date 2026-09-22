/**
 * Soft content filter for the mediated interview thread (Section 8.8).
 * Detects attempts to exchange contact details or discuss rates. Pure and testable.
 * It is deliberately over-inclusive: a held message is reviewed by Sales, never dropped.
 */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// 7+ digits with optional separators, or obvious "+63 917 ..." shapes. Avoids matching years or short ids.
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const MESSAGING_URL = /\b(?:wa\.me|whatsapp\.com|t\.me|telegram\.(?:me|org)|m\.me|messenger\.com|skype:|discord\.(?:gg|com)|signal\.me|viber\.com|linkedin\.com\/in\/|facebook\.com|instagram\.com|calendly\.com)\b/i;
const HANDLE_HINT = /\b(?:my (?:whatsapp|telegram|skype|viber|signal|discord|fb|facebook|ig|instagram|linkedin)|(?:whatsapp|telegram|skype|viber|signal) (?:me|number|id|handle))\b/i;

const RATE_TALK = [
  /\bsalary\b/i,
  /\bper hour\b/i,
  /\bhourly rate\b/i,
  /\bmonthly rate\b/i,
  /\bhow much (?:do|would) (?:you|u) (?:make|earn|charge|get|want|cost)\b/i,
  /\bwhat(?:'s| is) your rate\b/i,
  /\byour rate\b/i,
  /\bpay you\b/i,
  /\bpaid (?:per|by the) (?:hour|month)\b/i,
  /\bcompensation\b/i,
  /\bhire you directly\b/i,
  /\bwork (?:for me|with me) directly\b/i,
  /\boutside (?:of )?(?:the )?platform\b/i,
  /\bhow much (?:does|is) hirewise (?:charg|tak|keep)/i,
];

export type MessageScan = {
  contactInfo: boolean;
  rateTalk: boolean;
  reasons: string[];
};

export function scanMessage(body: string): MessageScan {
  const reasons: string[] = [];
  const text = body.normalize("NFKC");
  if (EMAIL.test(text)) reasons.push("email address");
  if (PHONE.test(text.replace(/\b(19|20)\d{2}\b/g, ""))) reasons.push("phone number");
  if (MESSAGING_URL.test(text)) reasons.push("messaging or social link");
  if (HANDLE_HINT.test(text)) reasons.push("messaging handle");
  const contactInfo = reasons.length > 0;
  const rateTalk = RATE_TALK.some((r) => r.test(text));
  if (rateTalk) reasons.push("rate or direct-hire language");
  return { contactInfo, rateTalk, reasons };
}
