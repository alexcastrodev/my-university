/** /notifications: replies to the reader's comments and mentions of them. */
export class NotificationsPage {
  constructor(page) {
    this.page = page;
    this.items = page.locator('app-notifications-page a.item');
  }

  async goto() {
    await this.page.goto('/notifications');
  }

  item(text) {
    return this.items.filter({ hasText: text });
  }
}
