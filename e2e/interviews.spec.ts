import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 2 acceptance through the real UI: a client requests an interview, the candidate
 * never sees the company before scheduling, Sales coordinates, and after scheduling the
 * candidate sees the company. Cleans up by cancelling the request and clearing the shortlist.
 */
const PASSWORD = "Hirewise!2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

async function logout(page: Page) {
  await page.evaluate(() => {
    const f = [...document.querySelectorAll("form")].find((x) => x.textContent?.includes("Sign out"));
    f?.requestSubmit();
  });
  await page.waitForURL("**/login");
}

test("interview request: company hidden from candidate until scheduled; Sales mediates", async ({ page }) => {
  test.setTimeout(240_000);

  // Client shortlists Jose and requests an interview.
  await login(page, "hiring@acme-solar.example");
  await page.goto("/talent");
  await page.getByRole("link", { name: "Jose R." }).first().click();
  await page.waitForURL(/\/talent\/[a-z0-9]+$/);
  // Idempotent: a previous run may have left Jose shortlisted.
  if ((await page.getByRole("button", { name: "Shortlisted" }).count()) === 0) {
    await page.getByRole("button", { name: "Shortlist", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Shortlisted" })).toBeVisible();
  await page.getByRole("link", { name: "Request interview" }).click();
  await expect(page).toHaveURL(/\/interviews\/new/);
  await page.getByLabel("Role").selectOption("Customer Service Representative");
  await page.getByLabel("Schedule").fill("Mon-Fri 9-5 PST");
  await page.getByRole("button", { name: "Request interviews" }).click();
  await page.waitForURL(/\/interviews\/[a-z0-9]+$/);
  const requestUrl = page.url();
  await expect(page.getByText("Requested", { exact: true }).first()).toBeVisible();
  await logout(page);

  // Candidate sees the role but not the company.
  await login(page, "jose@talent.example");
  await page.goto("/interviews");
  await expect(page.getByText("company shared at scheduling").first()).toBeVisible();
  await expect(page.getByText("Acme")).toHaveCount(0);
  await logout(page);

  // Sales starts review and proposes times.
  await login(page, "sales@hirewise.example");
  await page.goto("/staff/interviews");
  await page.locator("a[href^=\"/staff/interviews/\"]").first().click();
  await page.waitForURL(/\/staff\/interviews\/[a-z0-9]+$/);
  await page.getByRole("button", { name: "Start review (assign to me)" }).click();
  await expect(page.getByRole("button", { name: "Send proposed times to client" })).toBeVisible();
  await page.locator("textarea[name=message]").fill("Proposed: Thursday 9:00 AM or 10:00 AM PST, 30 minutes.");
  await page.getByRole("button", { name: "Send proposed times to client" }).click();
  await expect(page.getByText("Confirm on client's behalf")).toBeVisible();
  await logout(page);

  // Client confirms; message thread shows the Hirewise proposal.
  await login(page, "hiring@acme-solar.example");
  await page.goto(requestUrl);
  await expect(page.getByText("Proposed: Thursday")).toBeVisible();
  await page.getByRole("button", { name: "Confirm proposed times" }).click();
  await expect(page.getByText("Candidate confirmation", { exact: true })).toBeVisible();
  // A message with a phone number is held for review.
  await page.locator("textarea[name=body]").fill("Can Jose text me at +1 555 010 0199?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("pending Hirewise review")).toBeVisible();
  await logout(page);

  // Candidate confirms availability; still no company name.
  await login(page, "jose@talent.example");
  await page.goto("/interviews");
  await expect(page.getByText("Acme")).toHaveCount(0);
  await page.locator("a[href^=\"/interviews/\"]").first().click();
  await page.waitForURL(/\/interviews\/[a-z0-9]+$/);
  await page.getByRole("button", { name: "I am available" }).click();
  await expect(page.getByText("Your response").locator("..").getByText("Confirmed")).toBeVisible();
  await logout(page);

  // Sales schedules.
  await login(page, "sales@hirewise.example");
  await page.goto("/staff/compliance");
  await expect(page.getByText("Can Jose text me").first()).toBeVisible();
  await page.getByRole("button", { name: "Release" }).first().click();
  await expect(page.getByText("Can Jose text me")).toHaveCount(0);
  await page.goto("/staff/interviews?f=CANDIDATE_CONFIRMATION");
  await page.locator("a[href^=\"/staff/interviews/\"]").first().click();
  await page.waitForURL(/\/staff\/interviews\/[a-z0-9]+$/);
  const when = new Date(Date.now() + 2 * 86_400_000);
  const local = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}T09:00`;
  await page.locator("input[type=datetime-local]").first().fill(local);
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  // The page re-renders in SCHEDULED state once the action completes.
  await expect(page.getByText("Record each interview outcome")).toBeVisible();
  await logout(page);

  // Candidate now sees the company.
  await login(page, "jose@talent.example");
  await page.goto("/interviews");
  await expect(page.getByText("Acme Solar")).toBeVisible();
  await logout(page);

  // Clean up: client cancels; shortlist cleared.
  await login(page, "hiring@acme-solar.example");
  await page.goto(requestUrl);
  await page.locator("input[name=reason]").fill("e2e cleanup");
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await page.goto("/shortlist");
  await page.getByRole("button", { name: "Shortlisted" }).first().click();
  await expect(page.getByText("Your shortlist is empty")).toBeVisible();
});
