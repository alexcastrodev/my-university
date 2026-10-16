import { profileKey, publicProfileUrl } from './public-profile-url';

describe('publicProfileUrl', () => {
  const ID = '01a144df-4132-7737-aacd-4f9655f10d37';

  it('is an absolute link built from the id', () => {
    expect(publicProfileUrl(ID, 'https://example.com/')).toBe(`https://example.com/u/${ID}`);
  });

  it('keeps the locale sub path the app is served under', () => {
    expect(publicProfileUrl(ID, 'https://example.com/pt-BR/')).toBe(`https://example.com/pt-BR/u/${ID}`);
  });

  it('is built the same way from a slug the user chose', () => {
    expect(publicProfileUrl('lekitoonrails', 'https://example.com/')).toBe('https://example.com/u/lekitoonrails');
  });
});

describe('profileKey', () => {
  const ID = '01a144df-4132-7737-aacd-4f9655f10d37';

  it('prefers the slug the user chose', () => {
    expect(profileKey({ profileSlug: 'lekitoonrails', publicProfileId: ID })).toBe('lekitoonrails');
  });

  it('falls back to the id when there is no slug, whether it is null, empty or absent', () => {
    expect(profileKey({ profileSlug: null, publicProfileId: ID })).toBe(ID);
    expect(profileKey({ profileSlug: '', publicProfileId: ID })).toBe(ID);
    expect(profileKey({ publicProfileId: ID })).toBe(ID);
  });

  it('is null for a user cached before profiles existed, and for no user', () => {
    expect(profileKey({})).toBeNull();
    expect(profileKey(null)).toBeNull();
    expect(profileKey(undefined)).toBeNull();
  });
});
