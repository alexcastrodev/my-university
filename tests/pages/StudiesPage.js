/** The hub behind the phone tab bar's Study tab: one card per study area. */
export class StudiesPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading', { level: 1 });
    this.cards   = page.locator('a.card');
  }

  /** One card by its title ("Tracks", "Certifications", "Papers", "Computer Science"). */
  card(name) {
    return this.cards.filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }
}
