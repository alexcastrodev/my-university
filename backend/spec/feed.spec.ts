import { describe, it, expect } from 'vitest';
import { get, post, json, login } from './helpers';

describe('GET /feed', () => {
  it('is public and pages through the catalogue', async () => {
    const first = await json<any>(await get('/feed?limit=5'));
    expect(first.items).toHaveLength(5);
    expect(first.total).toBeGreaterThan(5);
    expect(first.nextOffset).toBe(5);
    expect(first.gotItToday).toBe(0);
    for (const item of first.items) {
      expect(item.title).toBeTruthy();
      expect(item.route.length).toBeGreaterThan(0);
      expect(item.read).toBe(false);
    }

    const second = await json<any>(await get('/feed?limit=5&offset=5'));
    const firstSlugs = new Set(first.items.map((i: any) => `${i.module}/${i.slug}`));
    expect(second.items.some((i: any) => firstSlugs.has(`${i.module}/${i.slug}`))).toBe(false);
  });

  it('filters by area', async () => {
    const spring = await json<any>(await get('/feed?area=spring&limit=30'));
    expect(spring.items.every((i: any) => i.module === 'spring-concepts')).toBe(true);

    const cs = await json<any>(await get('/feed?area=cs&limit=30'));
    expect(cs.items.every((i: any) => i.discipline && i.route[0] === '/computer-science')).toBe(true);
  });

  it('rejects an unknown area', async () => {
    const res = await get('/feed?area=cobol');
    expect(res.status).toBe(400);
  });

  it('never shows a diagram as the code snippet', async () => {
    const page = await json<any>(await get('/feed?limit=30'));
    for (const item of page.items) {
      if (item.code) expect(['mermaid', 'viz', 'text', '']).not.toContain(item.code.lang);
    }
  });

  it('serves title, summary and code snippet in the requested language', async () => {
    const page = await json<any>(await get('/feed?area=kubernetes&limit=30&lang=pt-BR'));
    const item = page.items.find((i: any) => i.code);
    expect(item).toBeTruthy();

    const detail = await json<any>(await get(`/kubernetes-concepts/${item.slug}?lang=pt-BR`));
    expect(detail.language).toBe('pt-BR');
    expect(item.title).toBe(detail.title);
    expect(item.summary).toBe(detail.summary);
    const firstLine = item.code.source.split('\n')[0];
    const body = detail.sections.map((s: any) => s.content).join('\n');
    expect(body).toContain(firstLine);
  });

  it('leaves out concepts not yet translated to the requested language', async () => {
    const all = await json<any>(await get('/feed?area=cs&limit=1&lang=en'));
    const page = await json<any>(await get('/feed?area=cs&limit=30&lang=pt-BR'));
    expect(page.total).toBeGreaterThan(0);
    expect(page.total).toBeLessThan(all.total);

    for (const item of page.items) {
      const detail = await json<any>(
        await get(`/curriculum/${item.module}/${item.discipline}/${item.slug}?lang=pt-BR`),
      );
      expect(detail.language).toBe('pt-BR');
    }
  });
});

describe('POST /feed/got-it', () => {
  it('requires a session', async () => {
    const res = await post('/feed/got-it', { module: 'spring-concepts', slug: 'x' });
    expect(res.status).toBe(401);
  });

  it('marks a concept read, schedules its review and counts it for today', async () => {
    const { cookie } = await login(`feed-gotit-${Date.now()}`);
    const page = await json<any>(await get('/feed?area=spring&limit=1', { Cookie: cookie }));
    const card = page.items[0];

    const res = await post('/feed/got-it', { module: card.module, slug: card.slug }, { Cookie: cookie });
    expect(res.status).toBe(201);
    expect((await json<any>(res)).gotItToday).toBe(1);

    const concepts = await json<any[]>(await get('/spring-concepts', { Cookie: cookie }));
    expect(concepts.find((c) => c.slug === card.slug)?.read).toBe(true);

    const marks = await json<any>(await get('/review/marks', { Cookie: cookie }));
    expect(marks.active).toBe(1);

    const after = await json<any>(await get('/feed?area=spring&limit=1', { Cookie: cookie }));
    expect(after.gotItToday).toBe(1);
    expect(after.items[0].slug).not.toBe(card.slug); // read cards sink to the end
  });

  it('marks a Computer Science concept through its discipline', async () => {
    const { cookie } = await login(`feed-gotit-cs-${Date.now()}`);
    const card = (await json<any>(await get('/feed?area=cs&limit=1', { Cookie: cookie }))).items[0];

    const res = await post(
      '/feed/got-it',
      { module: card.module, discipline: card.discipline, slug: card.slug },
      { Cookie: cookie },
    );
    expect(res.status).toBe(201);

    const list = await json<any[]>(
      await get(`/curriculum/${card.module}/${card.discipline}`, { Cookie: cookie }),
    );
    expect(list.find((c) => c.slug === card.slug)?.read).toBe(true);
  });

  it('404s on a concept that does not exist', async () => {
    const { cookie } = await login(`feed-gotit-404-${Date.now()}`);
    const res = await post('/feed/got-it', { module: 'spring-concepts', slug: 'nope' }, { Cookie: cookie });
    expect(res.status).toBe(404);
  });
});
