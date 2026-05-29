export class LoginPage {
  constructor(page) {
    this.page = page;
    this.loginTab = page.getByRole('tab', { name: 'Login' });
    this.signupTab = page.getByRole('tab', { name: 'Sign up' });
    this.nameInput = page.locator('input[type="text"]');
    this.submitBtn = page.locator('button[type="submit"]');
    this.errorMsg = page.locator('.error-msg');
    this.suggestSignupBtn = this.errorMsg.getByRole('button', { name: 'Create one instead' });
  }

  async login(name = 'Test User') {
    await this.loginTab.click();
    await this.nameInput.fill(name);
    await this.submitBtn.click();

    if (await this.suggestSignupBtn.isVisible().catch(() => false)) {
      await this.suggestSignupBtn.click();
      await this.submitBtn.click();
    }

    await this.page.waitForURL(/^(?!.*\/login).*/);
  }

  async signup(name = 'Test User') {
    await this.signupTab.click();
    await this.nameInput.fill(name);
    await this.submitBtn.click();
    await this.page.waitForURL(/^(?!.*\/login).*/);
  }
}
