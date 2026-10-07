import { topicFromUrl } from './discussion-topic';

describe('topicFromUrl', () => {
  it('reads the concept tracks, whatever their route prefix', () => {
    expect(topicFromUrl('/dotnet-concepts/domain-events')).toEqual({ module: 'dotnet-concepts', slug: 'domain-events' });
    expect(topicFromUrl('/java/jvm-concepts/gc')).toEqual({ module: 'jvm-concepts', slug: 'gc' });
    expect(topicFromUrl('/java/testing/mockito')).toEqual({ module: 'testing-concepts', slug: 'mockito' });
    expect(topicFromUrl('/system-design/system-design-concepts/saga')).toEqual({
      module: 'system-design-concepts',
      slug: 'saga',
    });
    expect(topicFromUrl('/java/java-minute/tip-1')).toEqual({ module: 'java-minute', slug: 'tip-1' });
    expect(topicFromUrl('/csharp-minute/tip-2')).toEqual({ module: 'csharp-minute', slug: 'tip-2' });
  });

  it('reads Computer Science concepts with their discipline', () => {
    expect(topicFromUrl('/computer-science/foundations/discrete-math/induction')).toEqual({
      module: 'foundations',
      discipline: 'discrete-math',
      slug: 'induction',
    });
  });

  it('ignores query, hash and a trailing slash', () => {
    expect(topicFromUrl('/spring-concepts/beans/?hl=x&m=3#top')).toEqual({ module: 'spring-concepts', slug: 'beans' });
  });

  it('is null for pages without discussions', () => {
    expect(topicFromUrl('/dotnet-concepts')).toBeNull();
    expect(topicFromUrl('/dashboard')).toBeNull();
    expect(topicFromUrl('/java/exam/ocp-25/lesson/l1')).toBeNull();
    expect(topicFromUrl('/computer-science/foundations/discrete-math')).toBeNull();
    expect(topicFromUrl('/dotnet-concepts/a/b')).toBeNull();
  });
});
