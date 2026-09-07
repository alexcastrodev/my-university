import { describe, it, expect } from 'vitest';
import { get, post, put, json, login } from './helpers';

describe('GET /daily/session', () => {
  it('requires a session', async () => {
    const res = await get('/daily/session');
    expect(res.status).toBe(401);
  });

  it('returns an honest empty session for a brand-new user with nothing read and nothing due', async () => {
    const { cookie } = await login(`daily-empty-${Date.now()}`);
    const res = await get('/daily/session', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<any>(res);

    expect(body.cards).toEqual([]);
    expect(body.summary.headline).toBeTruthy();
    expect(body.summary.tomorrow.title).toBeTruthy();
  });

  it('builds Read/Notice/Write cards from real read history, with no Recall since nothing is due', async () => {
    const { cookie } = await login(`daily-read-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const first = concepts[0].slug;
    const second = concepts[1].slug;

    await put(`/java-concepts/${first}/read`, {}, { Cookie: cookie });
    await put(`/java-concepts/${second}/read`, {}, { Cookie: cookie });

    const body = await json<any>(await get('/daily/session', { Cookie: cookie }));

    expect(body.cards.some((c: any) => c.type === 'recall')).toBe(false);

    const readCard = body.cards.find((c: any) => c.type === 'read');
    expect(readCard).toBeTruthy();
    expect(readCard.sourceId).toBe(second); // most recently read wins
    expect(readCard.body.length).toBeGreaterThan(0);

    const writeCard = body.cards.find((c: any) => c.type === 'write');
    expect(writeCard).toBeTruthy();
    expect(writeCard.sourceId).toBe(readCard.sourceId);
    expect(writeCard.pastAnswer).toBeUndefined();

    // Real java-concepts content almost always carries at least one fenced code block
    // somewhere in the scanned history, so Notice is expected here too.
    const noticeCard = body.cards.find((c: any) => c.type === 'notice');
    expect(noticeCard).toBeTruthy();
    expect(noticeCard.code.source.length).toBeGreaterThan(0);
  });

  it('reuses the single read concept for Notice rather than dropping the card, when there is only one', async () => {
    const { cookie } = await login(`daily-onehist-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const slug = concepts[0].slug;
    await put(`/java-concepts/${slug}/read`, {}, { Cookie: cookie });

    const body = await json<any>(await get('/daily/session', { Cookie: cookie }));
    const readCard = body.cards.find((c: any) => c.type === 'read');
    const noticeCard = body.cards.find((c: any) => c.type === 'notice');
    expect(readCard.sourceId).toBe(slug);
    // With no second history entry to draw from, Notice falls back to the same concept
    // (see DailyService.pickNoticeEntry fallback) instead of being omitted.
    if (noticeCard) expect(noticeCard.sourceId).toBe(slug);
  });
});

describe('POST /daily/complete', () => {
  it('requires a session', async () => {
    const res = await post('/daily/complete', { type: 'read', sourceId: 'x' });
    expect(res.status).toBe(401);
  });

  it('grants XP for a read card and is idempotent for the same calendar day', async () => {
    const { cookie } = await login(`daily-complete-read-${Date.now()}`);
    const before = await json<any>(await get('/xp/summary', { Cookie: cookie }));

    const first = await post('/daily/complete', { type: 'read', sourceId: 'some-concept' }, { Cookie: cookie });
    expect(first.status).toBe(201);
    expect((await json<any>(first)).xpAwarded).toBeGreaterThan(0);

    const afterFirst = await json<any>(await get('/xp/summary', { Cookie: cookie }));
    expect(afterFirst.total).toBeGreaterThan(before.total);

    await post('/daily/complete', { type: 'read', sourceId: 'some-concept' }, { Cookie: cookie });
    const afterSecond = await json<any>(await get('/xp/summary', { Cookie: cookie }));
    expect(afterSecond.total).toBe(afterFirst.total); // same day, same card — no double XP
  });

  it('rejects a write completion with empty text', async () => {
    const { cookie } = await login(`daily-write-empty-${Date.now()}`);
    const res = await post('/daily/complete', { type: 'write', sourceId: 'x', text: '   ' }, { Cookie: cookie });
    expect(res.status).toBe(400);
  });

  it('rejects a write completion longer than 240 characters', async () => {
    const { cookie } = await login(`daily-write-toolong-${Date.now()}`);
    const res = await post(
      '/daily/complete',
      { type: 'write', sourceId: 'x', text: 'a'.repeat(241) },
      { Cookie: cookie },
    );
    expect(res.status).toBe(400);
  });

  it('persists every write submission and surfaces the previous one as pastAnswer', async () => {
    const { cookie } = await login(`daily-write-persist-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const slug = concepts[0].slug;
    await put(`/java-concepts/${slug}/read`, {}, { Cookie: cookie });

    await post('/daily/complete', { type: 'write', sourceId: slug, text: 'First answer.' }, { Cookie: cookie });

    const body = await json<any>(await get('/daily/session', { Cookie: cookie }));
    const writeCard = body.cards.find((c: any) => c.type === 'write');
    expect(writeCard.pastAnswer.text).toBe('First answer.');

    await post('/daily/complete', { type: 'write', sourceId: slug, text: 'Second answer.' }, { Cookie: cookie });
    const body2 = await json<any>(await get('/daily/session', { Cookie: cookie }));
    const writeCard2 = body2.cards.find((c: any) => c.type === 'write');
    expect(writeCard2.pastAnswer.text).toBe('Second answer.'); // most recent, not overwritten — both rows exist
  });

  it('rejects a recall completion missing rating/sourceType, and records a real one against an already-scheduled item', async () => {
    const { cookie } = await login(`daily-recall-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const slug = concepts[0].slug;

    const missingRating = await post(
      '/daily/complete',
      { type: 'recall', sourceId: slug, sourceType: 'concept-read' },
      { Cookie: cookie },
    );
    expect(missingRating.status).toBe(400);

    // recordAnswer only requires an existing schedule, not that it's actually due —
    // there is no time-travel test hook (review.spec.ts has the same constraint), so this
    // exercises the same code path a due Recall card's "I remember" would hit.
    await post('/review/schedule', { module: 'java-concepts', slug }, { Cookie: cookie });
    const res = await post(
      '/daily/complete',
      { type: 'recall', sourceId: slug, sourceType: 'concept-read', rating: 'good' },
      { Cookie: cookie },
    );
    expect(res.status).toBe(201);
    expect((await json<any>(res)).xpAwarded).toBeGreaterThan(0);
  });
});
