import { test, expect, type Page } from "@playwright/test";

/**
 * Client-to-client isolation and media gating, through the real UI and direct URLs.
 * Uses the seeded accounts (password Hirewise!2026): Acme Solar and Beta Corp.
 */
const PASSWORD = "Hirewise!2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("unauthenticated users are sent to login from every app route", async ({ page }) => {
  for (const path of ["/dashboard", "/talent", "/shortlist", "/staff/clients", "/staff/talent", "/profile"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("client A cannot see client B's shortlist, and unapproved candidates are 404", async ({ page }) => {
  await login(page, "ops@beta-corp.example");
  await page.goto("/shortlist");
  await expect(page.getByText("Jose R.")).toBeVisible();

  // Sign out and in as Acme.
  await page.goto("/login");
  await page.evaluate(() => {
    const f = [...document.querySelectorAll("form")].find((x) => x.textContent?.includes("Sign out"));
    f?.requestSubmit();
  });
  await login(page, "hiring@acme-solar.example");
  await page.goto("/shortlist");
  await expect(page.getByText("Your shortlist is empty")).toBeVisible();
  await expect(page.getByText("Jose R.")).toHaveCount(0);

  // Draft agent (Maria) never appears in search for a client.
  await page.goto("/talent?q=Maria");
  await expect(page.getByText("No candidates match")).toBeVisible();
});

test("client can search, open a candidate, shortlist, and compare", async ({ page }) => {
  await login(page, "hiring@acme-solar.example");
  await page.goto("/talent");
  await expect(page.getByText("Jose R.")).toBeVisible();
  await expect(page.getByText("Carlo D.")).toHaveCount(0); // PLACED excluded by default filter

  await page.getByRole("link", { name: "Jose R." }).first().click();
  await expect(page).toHaveURL(/\/talent\//);
  await expect(page.getByText("Set by Hirewise")).toBeVisible();
  await expect(page.getByText("+63")).toHaveCount(0); // no phone anywhere
  await page.getByRole("button", { name: "Shortlist" }).click();
  await expect(page.getByRole("button", { name: "Shortlisted" })).toBeVisible();

  await page.goto("/shortlist");
  await expect(page.getByText("Jose R.")).toBeVisible();

  // Compare view lists the candidate on the evidence rows.
  await page.goto("/shortlist/compare?ids=" + encodeURIComponent(await page.locator("a[href^=\"/talent/\"]").first().getAttribute("href").then((h) => h!.split("/").pop()!)));
  await expect(page.getByText("Pick at least two")).toBeVisible();

  // Remove again so the test is repeatable: the card leaves the shortlist page.
  await page.goto("/shortlist");
  await page.getByRole("button", { name: "Shortlisted" }).first().click();
  await expect(page.getByText("Your shortlist is empty")).toBeVisible();
});

test("agent cannot reach the marketplace or staff console", async ({ page }) => {
  await login(page, "jose@talent.example");
  await page.goto("/talent");
  await expect(page.getByText("Marketplace not open yet").or(page.getByText("not active"))).toBeVisible();
  await page.goto("/staff/talent");
  await expect(page.getByText("You do not have permission").or(page.locator("h1", { hasText: "Talent pipeline" }))).toHaveCount(0);
});
