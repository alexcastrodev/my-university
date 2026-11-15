import { test, expect } from "@playwright/test";
import { BASE_URL } from "./BaseTest.js";
import { AdminPage, REPORT } from "./pages/AdminPage.js";

// The admin screen against the real stack. Names carry the time, so a rerun never meets what an earlier one left.
test.describe.configure({ mode: "serial" });
const stamp = Date.now();

async function signIn(page, displayName, role) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, {
    data: { displayName, ...(role ? { role } : {}) },
  });
  expect(
    res.ok(),
    "POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)",
  ).toBeTruthy();
  return (await res.json()).id;
}

/** A second account, in a context of its own, so the one under test keeps its session. */
async function makeUser(browser, displayName) {
  const context = await browser.newContext();
  const id = await signIn(context, displayName);
  await context.close();
  return id;
}

test.describe("Admin screen", () => {
  test("an account without a role has no way in", async ({ page }) => {
    const admin = new AdminPage(page);
    await signIn(page, `Plain ${stamp}`);
    await admin.goto();
    await expect(admin.denied).toBeVisible();
    await expect(admin.tab("users")).toHaveCount(0);
  });

  test("the admin finds the way in from the menu and sees the platform budget", async ({
    page,
    isMobile,
  }) => {
    const admin = new AdminPage(page);
    await signIn(page, `Boss ${stamp}`, "admin");
    await page.goto("/settings");
    if (isMobile) {
      await page.getByTestId("settings-admin").click();
    } else {
      await page.locator(".user-btn").click();
      await page.getByTestId("menu-admin").click();
    }
    await expect(page).toHaveURL(/\/admin$/);
    await expect(admin.budget).toContainText("$");
    for (const name of ["users", "roles", "reports", "audit"])
      await expect(admin.tab(name)).toBeVisible();
  });

  test("grants credits to a student, then reverses them, and both are in the audit trail", async ({
    page,
    browser,
  }) => {
    const admin = new AdminPage(page);
    const studentName = `Learner ${stamp}`;
    await makeUser(browser, studentName);
    await signIn(page, `Granter ${stamp}`, "admin");
    await admin.goto();
    await admin.searchUser(studentName);
    await admin.users.filter({ hasText: studentName }).first().click();
    await expect(admin.balance).toContainText("0");

    await expect(admin.grantSubmit).toBeDisabled();
    await admin.grant(25, "e2e grant");
    await expect(admin.balance).toContainText("25");
    await expect(admin.grants).toHaveCount(1);
    await expect(admin.grants.first()).toContainText("+25");

    await admin.reverseButton.click(); // first click asks for the reason
    await expect(admin.reverseReason).toBeVisible();
    await admin.reverseReason.fill("e2e mistake");
    await admin.reverseButton.click();
    await expect(admin.balance).toContainText("0");
    await expect(admin.grants).toHaveCount(2);
    await expect(admin.reverseButton).toHaveCount(0); // a grant is reversed once, a reversal never

    await admin.tab("audit").click();
    await expect(
      admin.auditEvents.filter({ hasText: "credit.reverse" }).first(),
    ).toContainText(studentName);
    await expect(
      admin.auditEvents.filter({ hasText: "credit.grant" }).first(),
    ).toContainText(studentName);
  });

  test("does not offer a grant to the own account", async ({ page }) => {
    const admin = new AdminPage(page);
    const name = `Selfish ${stamp}`;
    await signIn(page, name, "admin");
    await admin.goto();
    await admin.searchUser(name);
    await admin.users.filter({ hasText: name }).first().click();
    await expect(admin.grantSelf).toBeVisible();
    await expect(admin.grantAmount).toHaveCount(0);
  });

  test("makes a role, edits it and deletes it in two steps", async ({
    page,
  }) => {
    const admin = new AdminPage(page);
    const role = `e2e-role-${stamp}`;
    await signIn(page, `Roler ${stamp}`, "admin");
    await admin.goto();
    await admin.tab("roles").click();

    await admin.newRole.click();
    await expect(admin.roleSave).toBeDisabled(); // no name, no permission
    await admin.roleName.fill(role);
    await admin.permission("ai.use").check();
    await admin.roleSave.click();
    await expect(admin.roleRow(role)).toContainText("ai.use");

    await admin.roleRow(role).getByTestId("admin-role-edit").click();
    await admin.permission("users.view").check();
    await admin.roleSave.click();
    await expect(admin.roleRow(role)).toContainText("users.view");

    const del = admin.roleRow(role).getByTestId("admin-role-delete");
    await del.click();
    await expect(admin.roleRow(role)).toHaveCount(1); // still there: the first click only asks
    await del.click();
    await expect(admin.roleRow(role)).toHaveCount(0);
  });

  test("the system roles cannot be deleted, and the admin role cannot be edited", async ({
    page,
  }) => {
    const admin = new AdminPage(page);
    await signIn(page, `Guard ${stamp}`, "admin");
    await admin.goto();
    await admin.tab("roles").click();
    await expect(
      admin.roleRow("admin").getByTestId("admin-role-edit"),
    ).toHaveCount(0);
    await expect(
      admin.roleRow("admin").getByTestId("admin-role-delete"),
    ).toHaveCount(0);
    await expect(
      admin.roleRow("student").getByTestId("admin-role-delete"),
    ).toHaveCount(0);
  });

  test("reviews a Kurz report: reads the exchange, closes it, and it leaves the open list", async ({
    page,
  }) => {
    const admin = new AdminPage(page);
    await signIn(page, `Reviewer ${stamp}`, "admin");
    await admin.mockReports([REPORT]);
    await admin.goto();
    await admin.tab("reports").click();

    await expect(admin.reports).toHaveCount(1);
    await expect(admin.reports.first()).toContainText(
      "Does equals compare references?",
    );
    await expect(admin.reports.first()).toContainText("Yes, always.");
    await expect(admin.reports.first()).toContainText(
      "It says always, but it depends on the class",
    );
    await expect(
      admin.reports.first().getByTestId("admin-report-post"),
    ).toHaveAttribute("href", "/java/java-concepts/equals-vs-compareto");

    await admin.reports.first().getByTestId("admin-report-reviewed").click();
    await expect(admin.reports).toHaveCount(0);
    expect(admin.requests.find((r) => r.method === "PUT").body).toEqual({
      status: "reviewed",
    });

    await page.getByTestId("admin-reports-reviewed").click();
    await expect(admin.reports).toHaveCount(1);
    await expect(
      admin.reports.first().getByTestId("admin-report-status"),
    ).toHaveText("reviewed");
  });

  test("fits a phone screen without sideways scrolling", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone only");
    const admin = new AdminPage(page);
    await signIn(page, `Phoner ${stamp}`, "admin");
    await admin.goto();
    await expect(admin.tab("users")).toBeVisible();
    for (const name of ["users", "roles", "audit"]) {
      await admin.tab(name).click();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `tab ${name}`).toBeLessThanOrEqual(0);
    }
  });
});
