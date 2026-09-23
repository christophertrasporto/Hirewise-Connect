import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 4 acceptance: a client sees only their own invoices by direct URL.
 * Uses the seeded data: Acme Solar holds the paid deposit invoice for Carlo D.; Beta Corp holds none.
 */
const PASSWORD = "Hirewise!2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

async function signOut(page: Page) {
  await page.goto("/dashboard");
  await page.evaluate(() => {
    const f = [...document.querySelectorAll("form")].find((x) => x.textContent?.includes("Sign out"));
    f?.requestSubmit();
  });
  await page.waitForURL("**/login");
}

test("client sees only their own invoices by direct URL", async ({ page }) => {
  await login(page, "hiring@acme-solar.example");
  await page.goto("/billing");
  await expect(page.getByText("HW-", { exact: false }).first()).toBeVisible();
  const link = page.locator('a[href^="/billing/invoices/"]').first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await link.click();
  await expect(page).toHaveURL(new RegExp(href!));
  await expect(page.getByText("Placement deposit", { exact: false })).toBeVisible();
  await expect(page.getByText("Carlo D.", { exact: false }).first()).toBeVisible();

  await signOut(page);
  await login(page, "ops@beta-corp.example");
  await page.goto("/billing");
  await expect(page.getByText("No invoices yet")).toBeVisible();
  const res = await page.goto(href!);
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Placement deposit", { exact: false })).toHaveCount(0);

  // Agents have no billing area and never see amounts on a placement.
  await signOut(page);
  await login(page, "carlo@talent.example");
  await page.goto("/placements");
  await page.locator('a[href^="/placements/"]').first().click();
  await expect(page.getByText("Your compensation")).toBeVisible();
  await expect(page.getByText("USD 6.00 / hour")).toBeVisible();
  await expect(page.getByText("11.00")).toHaveCount(0);
  const billing = await page.goto("/billing");
  expect(billing?.status()).toBe(200);
  await expect(page.getByText("Clients only")).toBeVisible();
});
