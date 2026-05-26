export class LoginPage {
  constructor(page) {
    this.page = page;
    this.nameInput = page.locator('input[type="text"]');
    this.submitBtn = page.locator('button[type="submit"]');
  }

  async login(name = 'Test User') {
    await this.nameInput.fill(name);
    await this.submitBtn.click();
    await this.page.waitForURL(/^(?!.*\/login).*/);
  }
}
