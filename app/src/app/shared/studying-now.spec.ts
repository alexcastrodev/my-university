import { RecentActivityItem } from '../models/review.model';
import { deriveStudyingNow } from './studying-now';

const activity = (module: string, slug: string): RecentActivityItem => ({
  date: '2026-10-07',
  module,
  slug,
  title: slug,
  route: ['/x', module, slug],
  exp: 10,
});

describe('deriveStudyingNow', () => {
  it('lists each track once, newest first, linking to the last concept read', () => {
    const items = deriveStudyingNow(
      [activity('dotnet-concepts', 'b'), activity('dotnet-concepts', 'a'), activity('kubernetes-concepts', 'c')],
      null,
    );
    expect(items.map((i) => i.label)).toEqual(['.NET', 'Kubernetes']);
    expect(items[0].route).toEqual(['/x', 'dotnet-concepts', 'b']);
  });

  it('puts the resumable course first and respects the limit', () => {
    const items = deriveStudyingNow(
      [activity('dotnet-concepts', 'a'), activity('kubernetes-concepts', 'b'), activity('ruby-concepts', 'c')],
      { courseId: 'ocp-25', courseTitle: 'Java 25', lessonId: 'l1', lessonTitle: 'Lesson' },
    );
    expect(items.map((i) => i.label)).toEqual(['Java 25', '.NET', 'Kubernetes']);
    expect(items[0].route).toEqual(['/java/exam', 'ocp-25', 'lesson', 'l1']);
  });

  it('links to the course page when there is no lesson to resume', () => {
    const [item] = deriveStudyingNow([], { courseId: 'ocp-25', courseTitle: 'Java 25', lessonId: null, lessonTitle: null });
    expect(item.route).toEqual(['/java/exam', 'ocp-25']);
  });

  it('skips tracks it has no label for', () => {
    expect(deriveStudyingNow([activity('removed-track', 'a')], null)).toEqual([]);
  });
});
