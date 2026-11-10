import { localizedAlternates } from './seo-alternates';

describe('localizedAlternates', () => {
  it('lists the page and its pt-BR twin by default, as a list page needs', () => {
    expect(localizedAlternates('/kubernetes-concepts')).toEqual([
      { lang: 'en', path: '/kubernetes-concepts' },
      { lang: 'pt-BR', path: '/pt-BR/kubernetes-concepts' },
    ]);
  });

  it('lists only the translations that exist, never the fallback', () => {
    expect(localizedAlternates('/kubernetes-concepts/x', ['en'])).toEqual([
      { lang: 'en', path: '/kubernetes-concepts/x' },
    ]);
    expect(localizedAlternates('/kubernetes-concepts/x', ['pt-BR', 'en']).length).toBe(2);
  });
});
