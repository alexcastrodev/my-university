/**
 * Where the parts of a paper page sit: the title block, the aside of side cards and the body. The public paper page
 * and the reader's library entry share this markup, so one object serves both.
 */
export class PaperLayout {
  constructor(page) {
    this.page = page;

    this.header = page.locator('.paper-header');
    this.aside = page.locator('aside.side');
    this.body = page.locator('.paper-body');
  }

  /** Resizes the window and waits for the layout to settle: the content slides when the sidebar changes width. */
  async resize(width, height = 900) {
    await this.page.setViewportSize({ width, height });
    await this.page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  }

  async scrollTo(y) {
    await this.page.evaluate((to) => window.scrollTo(0, to), y);
  }

  /** The boxes of the three parts, in viewport coordinates. */
  async boxes() {
    return {
      header: await this.header.boundingBox(),
      aside: await this.aside.boundingBox(),
      body: await this.body.boundingBox(),
    };
  }

  /** The aside is `sticky` where it sits beside the body and `static` where it is stacked. */
  position() {
    return this.aside.evaluate((el) => getComputedStyle(el).position);
  }

  /** How far the page can be scrolled sideways: it should never be more than a pixel. */
  horizontalOverflow() {
    return this.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  }

  /** Elements of the page that start or end outside the viewport. */
  partsPastTheEdge() {
    return this.page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const found = [];
      for (const el of document.querySelectorAll('.page-body *')) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && (box.right > width + 0.5 || box.left < -0.5)) {
          found.push(`${el.tagName.toLowerCase()}.${el.className}: ${Math.round(box.left)} to ${Math.round(box.right)} in ${width}`);
        }
      }
      return found;
    });
  }

  /** Elements whose content is wider than their own box: text or a chip spilling out of it, or cut off. */
  partsWiderThanTheirBox() {
    return this.page.evaluate(() => {
      const found = [];
      for (const el of document.querySelectorAll('.page-body *')) {
        if (el.closest('svg')) continue;
        const style = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 1 && style.display !== 'inline' && style.overflowX === 'visible') {
          found.push(`${el.tagName.toLowerCase()}.${el.className}: content ${el.scrollWidth}px in a box of ${el.clientWidth}px`);
        }
      }
      return found;
    });
  }

  /**
   * Scrolls the aside to its end and the last card into view, then says where the card is and where the room ends
   * (the bottom of the viewport, or the top of the phone tab bar when there is one).
   */
  revealLastCard() {
    return this.aside.evaluate((aside) => {
      const cards = [...aside.children].filter((card) => getComputedStyle(card).display !== 'none');
      const last = cards[cards.length - 1];
      aside.scrollTop = aside.scrollHeight;
      last.scrollIntoView({ block: 'center' });
      const box = last.getBoundingClientRect();
      const bar = document.querySelector('nav.bottom-nav');
      const barBox = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect() : null;
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        floor: barBox ? barBox.top : window.innerHeight,
        width: document.documentElement.clientWidth,
      };
    });
  }
}
