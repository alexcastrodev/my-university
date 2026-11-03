import { toConceptLinkItem } from './concept-links';

describe('toConceptLinkItem', () => {
  it('links a related concept to its own track by default and to another track when it names one', () => {
    expect(toConceptLinkItem({ label: 'A', slug: 'a' }, 'dotnet-concepts').route).toEqual(['/dotnet-concepts', 'a']);
    expect(toConceptLinkItem({ label: 'B', slug: 'b', feature: 'system-design' }, 'dotnet-concepts').route).toEqual([
      '/system-design/system-design-concepts',
      'b',
    ]);
  });

  it('keeps a free-text mention as a plain label', () => {
    expect(toConceptLinkItem('Just text', 'java-concepts')).toEqual({ label: 'Just text', route: null });
  });

  it('shows a plain label, not a link with an undefined path segment, for a feature it does not know', () => {
    const ref = { label: 'C', slug: 'c', feature: 'system-design-concepts' } as unknown as Parameters<typeof toConceptLinkItem>[0];
    expect(toConceptLinkItem(ref, 'dotnet-concepts')).toEqual({ label: 'C', route: null });
  });
});
