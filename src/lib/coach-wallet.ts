/**
 * Coach Wallet maths, as pure functions: no database, no clock of their own, no floating point for money. Every amount
 * is an integer in minor units (centavos). The service (`wallet.service.ts`) loads the facts and calls these.
 */

/** Per-coach overrides are capped here so the platform share can always cover the affiliate commission (15% of the sale). */
export const MAX_COACH_SHARE_BPS = 8000;

export type SplitInput = {
  /** What the buyer actually paid, after discounts. */
  saleMinor: number;
  /** The actual fee the gateway charged for this transaction. */
  feeMinor: number;
  coachBps: number;
  /** The affiliate commission on this sale; paid out of the platform share. */
  affiliateMinor?: number;
};

export type Split = {
  saleMinor: number;
  feeMinor: number;
  netMinor: number;
  coachMinor: number;
  platformMinor: number;
  affiliateMinor: number;
  /** The platform share after the affiliate commission. Can be negative if the commission exceeds the share. */
  platformKeepsMinor: number;
};

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/**
 * net = sale - fee. The coach gets floor(net x rate); the platform gets whatever is left, so the two always add up to
 * the net exactly and any remainder centavo goes to the platform. The affiliate commission comes out of the platform
 * share and never reduces the coach's.
 */
export function splitSale(p: SplitInput): Split {
  const affiliate = p.affiliateMinor ?? 0;
  if (!isInt(p.saleMinor) || p.saleMinor <= 0) throw new Error("The sale amount must be a positive integer in minor units.");
  if (!isInt(p.feeMinor) || p.feeMinor < 0 || p.feeMinor > p.saleMinor) throw new Error("The gateway fee must be a whole amount between zero and the sale amount.");
  if (!isInt(p.coachBps) || p.coachBps < 0 || p.coachBps > 10_000) throw new Error("The coach share must be between 0 and 10000 basis points.");
  if (!isInt(affiliate) || affiliate < 0) throw new Error("The affiliate amount must be a non-negative integer in minor units.");
  const netMinor = p.saleMinor - p.feeMinor;
  const coachMinor = Math.floor((netMinor * p.coachBps) / 10_000);
  const platformMinor = netMinor - coachMinor;
  return { saleMinor: p.saleMinor, feeMinor: p.feeMinor, netMinor, coachMinor, platformMinor, affiliateMinor: affiliate, platformKeepsMinor: platformMinor - affiliate };
}

/**
 * `part x refunded / sale`, rounded down, exact for any realistic amount (BigInt avoids overflow). A refund of the whole
 * sale returns the whole part, so a series of partial refunds can never reverse more than was credited.
 */
export function proportionalShare(partMinor: number, refundedMinor: number, saleMinor: number): number {
  if (!isInt(partMinor) || !isInt(refundedMinor) || !isInt(saleMinor) || partMinor < 0 || refundedMinor < 0 || saleMinor <= 0) throw new Error("Amounts must be whole numbers in minor units.");
  if (refundedMinor >= saleMinor) return partMinor;
  return Number((BigInt(partMinor) * BigInt(refundedMinor)) / BigInt(saleMinor));
}

/** When a new earning becomes withdrawable: the sale date plus the refund window plus the buffer. */
export function availableAtFor(paidAt: Date, refundWindowDays: number, holdBufferDays: number): Date {
  return new Date(paidAt.getTime() + (refundWindowDays + holdBufferDays) * 86_400_000);
}

/** "Maria S." from "Maria Santos": first name and last initial, never more. */
export function buyerLabel(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A learner";
  const first = parts[0];
  return parts.length === 1 ? first : `${first} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "102.47", "₱1,250.00", "PHP 12" to minor units without floats; null when it is not an amount. */
export function parseMoneyToMinor(raw: string): number | null {
  const cleaned = raw.replace(/[₱$\s]|PHP|USD/gi, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

export type FeeRow = { line: number; reference: string; feeMinor: number | null; error?: string };

const REFERENCE_HEADERS = ["payment id", "payment_id", "paymentid", "transaction id", "transaction_id", "request reference number", "request_reference_number", "reference number", "reference", "rrn", "checkout id", "id"];
const FEE_HEADERS = ["fee", "fees", "transaction fee", "transaction_fee", "gateway fee", "mdr", "mdr amount", "processing fee", "total fee", "discount fee"];

/** Splits one CSV line, honouring double quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Reads a settlement report (or any two-column list) with a header row naming a reference column (Maya payment id,
 * request reference number, or our enrolment id) and a fee column. Header names are matched loosely; the first matching
 * column of each kind is used. Returns every data row with its fee, or the reason the row cannot be used.
 */
export function parseFeeCsv(text: string): { rows: FeeRow[]; error?: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: [], error: "The file needs a header row and at least one data row." };
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const refIdx = headers.findIndex((h) => REFERENCE_HEADERS.includes(h));
  const feeIdx = headers.findIndex((h) => FEE_HEADERS.includes(h));
  if (refIdx < 0 || feeIdx < 0) return { rows: [], error: `Could not find the columns. The header row must include a reference column (for example "Payment ID" or "Reference") and a fee column (for example "Fee" or "MDR"). Found: ${headers.join(", ")}.` };
  const rows: FeeRow[] = lines.slice(1).map((l, i) => {
    const cells = splitCsvLine(l);
    const reference = cells[refIdx] ?? "";
    const feeMinor = parseMoneyToMinor(cells[feeIdx] ?? "");
    if (!reference) return { line: i + 2, reference, feeMinor: null, error: "No reference." };
    if (feeMinor === null) return { line: i + 2, reference, feeMinor: null, error: `"${cells[feeIdx] ?? ""}" is not an amount.` };
    return { line: i + 2, reference, feeMinor };
  });
  return { rows };
}
