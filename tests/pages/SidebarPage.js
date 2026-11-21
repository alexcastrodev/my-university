export class SidebarPage {
  constructor(page) {
    this.page = page;

    // The left rail that replaced the top header; hidden on phones (the bottom tab bar takes over).
    this.sidebar     = page.locator('aside.sidebar');
    this.brandLink   = page.getByRole('link', { name: 'My University Home' });
    this.tracksLink  = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Tracks' });
    this.certificationsLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Certifications', exact: true });
    // Papers is the public catalog; "My library" is the signed-in reader's own shelf, so it sits next to it.
    this.papersLink  = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Papers', exact: true });
    this.libraryLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My library', exact: true });
    // On phones the sidebar is gone and this tab bar takes over.
    this.bottomNav   = page.getByRole('navigation', { name: 'Primary' });
    this.bottomNavPt = page.getByRole('navigation', { name: 'Principal' });
    this.bottomLabels = page.locator('nav.bottom-nav .tab span');
    // Opens the platform-wide search palette (the sidebar only holds the trigger button).
    this.searchInput = page.getByRole('button', { name: 'Search courses' });
    this.searchDialog = page.getByRole('dialog', { name: 'Search the platform' });
    this.searchBox   = this.searchDialog.getByRole('combobox', { name: 'Search' });
    this.avatarBtn   = page.getByRole('button', { name: 'User account menu' });

    // The card is an icon rail unless the reader expanded it; <html data-sidebar> says which, and the page's
    // shell sits to the right of it.
    this.root        = page.locator('html');
    this.mainNav     = page.getByRole('navigation', { name: 'Main navigation' });
    this.appShell    = page.locator('.app-shell');
    this.collapseBtn = page.getByRole('button', { name: 'Collapse sidebar' });
    this.expandBtn   = page.getByRole('button', { name: 'Expand sidebar' });
    // One tooltip for the whole rail, shown on hover or keyboard focus of an icon.
    this.tooltip     = page.getByRole('tooltip');
    // Light | Dark, as two toggle buttons in a group.
    this.themeGroup  = page.getByRole('group', { name: 'Color theme' });
    this.lightBtn    = this.themeGroup.getByRole('button', { name: 'Light' });
    this.darkBtn     = this.themeGroup.getByRole('button', { name: 'Dark' });
  }

  /** A link of the Main navigation, by its name. */
  navLink(name) {
    return this.mainNav.getByRole('link', { name, exact: true });
  }

  /** The small caps title of a group of links ("Study"); only the expanded card shows them. */
  groupTitle(name) {
    return this.mainNav.getByText(name, { exact: true });
  }

  /** The id the tooltip has, which the icon it points at names in aria-describedby. */
  get tooltipId() {
    return this.tooltip.getAttribute('id');
  }

  /** Opens the app on a public page, which is where the sidebar's own controls all work. */
  async goto() {
    await this.page.goto('/tracks');
  }

  async reload() {
    await this.page.reload();
  }

  /** Takes the pointer off the card, to the middle of the page. */
  async pointerAway() {
    await this.page.mouse.move(700, 400);
  }

  async pressTab() {
    await this.page.keyboard.press('Tab');
  }

  async pressEscape() {
    await this.page.keyboard.press('Escape');
  }

  /** Shows the page as a reader would find it: at a width, with the card expanded or as a rail (the saved choice). */
  async showAs(state, width, height = 800) {
    await this.page.setViewportSize({ width, height });
    await this.page.evaluate((value) => localStorage.setItem('sidebar-collapsed', value), state === 'rail' ? '1' : '0');
    await this.page.reload();
    await this.page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  }

  cardBox() {
    return this.sidebar.boundingBox();
  }

  /** Where the tooltip ended up: it fades in sliding a few pixels, so the box is read once that is over. */
  async tooltipBox() {
    await this.page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    return this.tooltip.boundingBox();
  }

  /** Where the page starts, relative to where the card ends: the air that --mu-sidebar-w keeps free. */
  async gapToContent() {
    const card = await this.cardBox();
    const shell = await this.appShell.boundingBox();
    return shell.x - (card.x + card.width);
  }

  /** How far the page can be scrolled sideways: it should never be more than a pixel. */
  horizontalOverflow() {
    return this.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  }

  /** One tab of the phone bar, by its visible label. */
  bottomTab(name, nav = this.bottomNav) {
    return nav.getByRole('link', { name, exact: true });
  }

  /** True when no tab label is cut off by the width of its tab. */
  async bottomLabelsFit() {
    return this.bottomLabels.evaluateAll((spans) => spans.every((s) => s.scrollWidth <= s.clientWidth));
  }
}
