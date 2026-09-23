import { describe, expect, it } from "vitest";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { assertPlacementTransition, IllegalTransitionError, computeDeposit, monthlyEquivalent, DEPLOYMENT_CHECKLIST_TEMPLATE } from "@/server/state/placement";
import { renderSimplePdf } from "@/server/adapters/pdf";
import { toCsv } from "@/server/services/report.service";

const pl = (status: Parameters<typeof assertPlacementTransition>[1]["status"]) => ({ status, clientId: "client_a" });

describe("Placement state machine (Section 5.5)", () => {
  it("follows the pipeline with the right actors", () => {
    const admin = makeActor("ADMIN");
    const client = makeActor("CLIENT", { clientId: "client_a" });
    const ops = makeActor("OPERATIONS");
    const sales = makeActor("SALES");
    expect(() => assertPlacementTransition(admin, pl("SELECTED"), "AWAITING_AGREEMENT")).not.toThrow();
    expect(() => assertPlacementTransition(client, pl("AWAITING_AGREEMENT"), "AWAITING_DEPOSIT")).not.toThrow();
    expect(() => assertPlacementTransition(sales, pl("AWAITING_AGREEMENT"), "AWAITING_DEPOSIT")).not.toThrow(); // signed upload by staff
    expect(() => assertPlacementTransition(admin, pl("AWAITING_DEPOSIT"), "DEPLOYMENT_PREP", undefined, true)).not.toThrow();
    expect(() => assertPlacementTransition(ops, pl("DEPLOYMENT_PREP"), "ACTIVE")).not.toThrow();
    expect(() => assertPlacementTransition(ops, pl("ACTIVE"), "PAUSED", "Client holiday")).not.toThrow();
    expect(() => assertPlacementTransition(ops, pl("PAUSED"), "ACTIVE")).not.toThrow();
    expect(() => assertPlacementTransition(sales, pl("ACTIVE"), "COMPLETED", "Contract ended")).not.toThrow();
  });

  it("only placement.approve gives Hirewise approval; Sales and Operations cannot", () => {
    expect(() => assertPlacementTransition(makeActor("SALES"), pl("SELECTED"), "AWAITING_AGREEMENT")).toThrow(ForbiddenError);
    expect(() => assertPlacementTransition(makeActor("OPERATIONS"), pl("SELECTED"), "AWAITING_AGREEMENT")).toThrow(ForbiddenError);
    expect(() => assertPlacementTransition(makeActor("SUPER_ADMIN"), pl("SELECTED"), "AWAITING_AGREEMENT")).not.toThrow();
  });

  it("the deposit step is system-only: no user can move AWAITING_DEPOSIT → DEPLOYMENT_PREP directly", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "SALES", "OPERATIONS"] as const) expect(() => assertPlacementTransition(makeActor(role), pl("AWAITING_DEPOSIT"), "DEPLOYMENT_PREP")).toThrow(ForbiddenError);
    expect(() => assertPlacementTransition(makeActor("CLIENT", { clientId: "client_a" }), pl("AWAITING_DEPOSIT"), "DEPLOYMENT_PREP")).toThrow(ForbiddenError);
  });

  it("refuses skipped steps, other clients, and activation without placement.activate", () => {
    expect(() => assertPlacementTransition(makeActor("ADMIN"), pl("SELECTED"), "ACTIVE")).toThrow(IllegalTransitionError);
    expect(() => assertPlacementTransition(makeActor("ADMIN"), pl("AWAITING_AGREEMENT"), "ACTIVE")).toThrow(IllegalTransitionError);
    expect(() => assertPlacementTransition(makeActor("CLIENT", { clientId: "client_b" }), pl("AWAITING_AGREEMENT"), "AWAITING_DEPOSIT")).toThrow(ForbiddenError);
    expect(() => assertPlacementTransition(makeActor("SALES"), pl("DEPLOYMENT_PREP"), "ACTIVE")).toThrow(ForbiddenError);
    expect(() => assertPlacementTransition(makeActor("RECRUITER"), pl("ACTIVE"), "PAUSED", "x")).toThrow(ForbiddenError);
  });

  it("cancellation needs a reason and is impossible from terminal states", () => {
    expect(() => assertPlacementTransition(makeActor("SALES"), pl("AWAITING_DEPOSIT"), "CANCELLED")).toThrow(/reason/i);
    expect(() => assertPlacementTransition(makeActor("SALES"), pl("AWAITING_DEPOSIT"), "CANCELLED", "Client withdrew")).not.toThrow();
    expect(() => assertPlacementTransition(makeActor("SALES"), pl("COMPLETED"), "CANCELLED", "x")).toThrow(IllegalTransitionError);
    expect(() => assertPlacementTransition(makeActor("SALES"), pl("CANCELLED"), "ACTIVE")).toThrow(IllegalTransitionError);
  });

  it("ships the Section 8.6 checklist template", () => {
    expect(DEPLOYMENT_CHECKLIST_TEMPLATE.filter((i) => i.isRequired).length).toBeGreaterThanOrEqual(4);
  });
});

describe("deposit calculation (Section 8.6, Q6)", () => {
  const hourly = { amount: 1000, currency: "USD", unit: "HOURLY" as const };
  const monthly = { amount: 150_000, currency: "USD", unit: "MONTHLY" as const };
  it("one month = rate × hoursPerMonth for hourly, or the monthly rate", () => {
    expect(monthlyEquivalent(hourly, 173)).toBe(173_000);
    expect(monthlyEquivalent(monthly, 173)).toBe(150_000);
    expect(computeDeposit({ type: "ONE_MONTH", value: 0, currency: null }, hourly, 173)).toEqual({ amount: 173_000, currency: "USD" });
    expect(computeDeposit({ type: "ONE_MONTH", value: 0, currency: null }, monthly, 173)).toEqual({ amount: 150_000, currency: "USD" });
  });
  it("two weeks, fixed, percentage, and custom", () => {
    expect(computeDeposit({ type: "TWO_WEEKS", value: 0, currency: null }, hourly, 173).amount).toBe(86_500);
    expect(computeDeposit({ type: "FIXED", value: 50_000, currency: "USD" }, hourly, 173)).toEqual({ amount: 50_000, currency: "USD" });
    expect(computeDeposit({ type: "PERCENTAGE", value: 2500, currency: null }, monthly, 173).amount).toBe(37_500);
    expect(computeDeposit({ type: "CUSTOM", value: 0, currency: null }, hourly, 173, 12_345).amount).toBe(12_345);
    expect(() => computeDeposit({ type: "CUSTOM", value: 0, currency: null }, hourly, 173, null)).toThrow(/custom/i);
  });
});

describe("helpers", () => {
  it("renders a structurally valid PDF with escaped text", () => {
    const pdf = renderSimplePdf([{ text: "Invoice (HW-2026-00001)", bold: true }, { text: "Amount: USD 1,903.00 → due" }]);
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("\\(HW-2026-00001\\)");
    expect(s).toContain("%%EOF");
    expect(s).not.toContain("→");
  });
  it("escapes CSV cells", () => {
    expect(toCsv([{ a: 'x,"y"', b: 1, c: null }])).toBe('a,b,c\n"x,""y""",1,');
  });
});
