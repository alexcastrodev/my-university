import { publicProfileUrl } from './public-profile-url';

describe('publicProfileUrl', () => {
  const ID = '01a144df-4132-7737-aacd-4f9655f10d37';

  it('is an absolute link built from the id', () => {
    expect(publicProfileUrl(ID, 'https://example.com/')).toBe(`https://example.com/u/${ID}`);
  });

  it('keeps the locale sub path the app is served under', () => {
    expect(publicProfileUrl(ID, 'https://example.com/pt-BR/')).toBe(`https://example.com/pt-BR/u/${ID}`);
  });
});
