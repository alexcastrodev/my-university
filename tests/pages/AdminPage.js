/**
 * The admin screen (/admin): budget, and the tabs of users, roles, Kurz reports and audit. Everything runs against
 * the real API (the account is made by `_test/login` with the admin role); only the reports are answered by `mockReports`,
 * because a report needs a Kurz answer, which needs the model.
 */
export class AdminPage {
  constructor(page) {
    this.page = page;
    this.denied = page.getByTestId("admin-denied");
    this.budget = page.getByTestId("admin-budget");
    this.tab = (name) => page.getByTestId(`admin-tab-${name}`);
    this.notice = page.getByTestId("admin-notice");

    this.search = page.getByTestId("admin-user-search");
    this.searchGo = page.getByTestId("admin-user-search-go");
    this.users = page.getByTestId("admin-user");
    this.detail = page.getByTestId("admin-user-detail");
    this.balance = page.getByTestId("admin-user-balance");
    this.grantAmount = page.getByTestId("admin-grant-amount");
    this.grantReason = page.getByTestId("admin-grant-reason");
    this.grantSubmit = page.getByTestId("admin-grant-submit");
    this.grantSelf = page.getByTestId("admin-grant-self");
    this.grants = page.getByTestId("admin-grant");
    this.reverseButton = page.getByTestId("admin-grant-reverse");
    this.reverseReason = page.getByTestId("admin-reverse-reason");

    this.roles = page.getByTestId("admin-role");
    this.newRole = page.getByTestId("admin-role-new");
    this.roleName = page.getByTestId("admin-role-name");
    this.roleLimit = page.getByTestId("admin-role-limit");
    this.roleSave = page.getByTestId("admin-role-save");
    this.permission = (id) => page.getByTestId(`admin-perm-${id}`);

    this.reports = page.getByTestId("admin-report");
    this.auditEvents = page.getByTestId("admin-audit-event");
    this.requests = [];
  }

  async goto() {
    await this.page.goto("/admin");
  }

  async searchUser(text) {
    await this.search.fill(text);
    await this.searchGo.click();
  }

  async grant(amount, reason) {
    await this.grantAmount.fill(String(amount));
    await this.grantReason.fill(reason);
    await this.grantSubmit.click();
  }

  roleRow(name) {
    return this.roles.filter({ hasText: name });
  }

  /** Answers GET and PUT of /api/admin/ai/reports. `reports` is the list the server has; a PUT closes the report. */
  async mockReports(reports) {
    this.reportList = reports.map((r) => ({ ...r }));
    await this.page.route(/\/api\/admin\/ai\/reports/, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      this.requests.push({
        method: request.method(),
        path: url.pathname,
        query: url.search,
        body: request.postDataJSON?.() ?? null,
      });
      if (request.method() === "PUT") {
        const id = url.pathname.split("/").pop();
        const status = request.postDataJSON().status;
        this.reportList = this.reportList.map((r) =>
          r.id === id ? { ...r, status } : r,
        );
        return route.fulfill({ status: 204 });
      }
      const wanted = url.searchParams.get("status");
      const list = this.reportList.filter(
        (r) => wanted === "all" || r.status === wanted,
      );
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(list),
      });
    });
  }
}

export const REPORT = {
  id: "01-report",
  createdAt: "2030-01-01T10:00:00.000Z",
  status: "open",
  // The server's routes start with '/', as `routerLink` wants them.
  route: ["/java", "java-concepts", "equals-vs-compareto"],
  lang: "en",
  postVersion: "1.2",
  selection: "equals compares contents",
  question: "Does equals compare references?",
  answer: {
    answerable: true,
    blocks: [{ kind: "claim", text: "Yes, always.", cites: [] }],
    citations: [],
    see: [],
    followUps: [],
  },
  model: "gemini-3.5-flash-lite",
  promptVersion: 1,
  note: "It says always, but it depends on the class",
  reviewedAt: null,
};
