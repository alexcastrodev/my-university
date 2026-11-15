/**
 * The Kurz on a concept page: the selection menu, the panel with its two tabs, the floating button on phones.
 * The API is answered by `mock`, so the states (no credit, terms, budget spent) do not depend on the database;
 * the page itself, and the paragraphs it carries, come from the real server.
 */
export const KURZ_STATUS = {
  enabled: true,
  termsVersion: '1',
  termsRequired: false,
  balance: 40,
  dailyLimit: 50,
  usedLast24h: 5,
  platformBudget: { period: 'month', usedPercent: 12, resetsAt: '2030-01-01T00:00:00.000Z' },
  blocked: null,
};

export class KurzPage {
  constructor(page) {
    this.page = page;
    this.paragraphs = page.locator('app-concept-detail-layout .section-body > p');
    this.markers = page.locator('.dz-marker');
    this.menu = page.getByRole('toolbar', { name: 'Ask about the selected text' });
    this.askKurzButton = page.getByTestId('ask-kurz');
    this.panel = page.getByRole('complementary', { name: 'Paragraph discussion' });
    this.kurzTab = page.getByTestId('tab-kurz');
    this.discussionTab = page.getByTestId('tab-discussion');
    this.welcome = page.getByTestId('kurz-welcome');
    this.input = page.getByTestId('kurz-input');
    this.sendButton = page.getByTestId('kurz-send');
    this.answers = page.getByTestId('kurz-answer');
    this.cites = page.getByTestId('kurz-cite');
    this.refused = page.getByTestId('kurz-refused');
    this.error = page.getByTestId('kurz-error');
    this.blocked = page.getByTestId('kurz-blocked');
    this.budget = page.getByTestId('kurz-budget');
    this.terms = page.getByTestId('kurz-terms');
    this.adult = page.getByTestId('kurz-adult');
    this.accept = page.getByTestId('kurz-accept');
    this.openIn = page.getByTestId('kurz-open-in');
    this.fab = page.getByTestId('kurz-fab');
    this.requests = [];
  }

  /**
   * Answers /api/kurz. `ask` is the body of the answer to a question (or a function of the request body, or a
   * `{ status, body }` to fail); `terms` and `status` change as the student goes on.
   */
  async mock({ status = KURZ_STATUS, conversations = [], ask } = {}) {
    this.status = { ...status };
    // A regular expression: the glob `**/api/kurz/**` does not match the question itself, a POST to `/api/kurz`.
    await this.page.route(/\/api\/kurz(\/|\?|$)/, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace('/api/kurz', '') || '/';
      const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
      this.requests.push({ method: request.method(), path, body: request.postDataJSON?.() ?? null });

      if (path === '/status') return json(this.status);
      if (path === '/conversations' && request.method() === 'GET') return json(conversations);
      if (path === '/conversations' && request.method() === 'DELETE') return json({ deleted: 3 });
      if (path === '/terms') {
        this.status = { ...this.status, termsRequired: false };
        return route.fulfill({ status: 204 });
      }
      if (path === '/') {
        const reply = typeof ask === 'function' ? ask(request.postDataJSON()) : ask;
        if (reply?.status) return json(reply.body ?? {}, reply.status);
        return json(reply);
      }
      return route.fulfill({ status: 204 });
    });
  }

  async goto(path = '/java/java-concepts/equals-vs-compareto') {
    await this.page.goto(path);
    await this.paragraphs.first().waitFor();
    // The page draws a marker on every paragraph once its content has settled: from then on the text stays put.
    await this.markers.first().waitFor({ state: 'attached' });
    await this.page.waitForLoadState('networkidle');
  }

  /** The text of a paragraph, as a reader sees it. */
  async paragraphText(index) {
    return (await this.paragraphs.nth(index).innerText()).replace(/\s+/g, ' ').trim();
  }

  /** Selects the first `length` characters of a paragraph the way a reader dragging over them does. */
  async select(index = 0, length = 60) {
    await this.page.evaluate(
      ([i, n]) => {
        const p = document.querySelectorAll('app-concept-detail-layout .section-body > p')[i];
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode();
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, Math.min(n, node.length));
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      },
      [index, length],
    );
  }

  /** A reader clicks the first paragraph (not selecting anything), which opens its panel. */
  async openParagraph(index = 0) {
    await this.paragraphs.nth(index).click({ position: { x: 5, y: 5 } });
  }

  async ask(question) {
    await this.input.fill(question);
    await this.sendButton.click();
  }

  asked() {
    return this.requests.filter((r) => r.method === 'POST' && r.path === '/');
  }
}

/** An answer as the server sends it, quoting `quote` (a passage that is on the page). */
export function answerOf(question, quote, extra = {}) {
  return {
    conversationId: '0198a0a0-0000-7000-8000-0000000000c1',
    credits: 4,
    balance: 36,
    message: {
      id: '0198a0a0-0000-7000-8000-0000000000d1',
      question,
      outcome: 'answered',
      helpful: null,
      createdAt: '2030-01-01T00:00:00.000Z',
      answer: {
        answerable: true,
        blocks: [{ kind: 'claim', text: 'It compares **two objects** by their natural order.', cites: [1] }],
        citations: [{ n: 1, source: 'S1', title: 'Post', route: [], section: 'Objective', p: 1, quote }],
        see: [],
        followUps: ['Show an example'],
      },
      ...extra,
    },
  };
}
