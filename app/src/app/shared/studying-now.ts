import { RecentActivityItem } from '../models/review.model';
import { ResumePoint } from '../models/course.model';
import { areaLabel } from './area-labels';

export interface StudyingNowItem {
  label: string;
  route: string[];
}

/**
 * What the sidebar lists under "Studying now": the course that can be resumed, then the tracks
 * touched most recently (newest first, one entry per track, linking to the last concept read
 * there). Built from data the dashboard already loads, so there is no endpoint of its own.
 */
export function deriveStudyingNow(
  recent: RecentActivityItem[],
  resume: ResumePoint | null,
  max = 3,
): StudyingNowItem[] {
  const items: StudyingNowItem[] = [];
  if (resume) {
    items.push({
      label: resume.courseTitle,
      route: resume.lessonId
        ? ['/java/exam', resume.courseId, 'lesson', resume.lessonId]
        : ['/java/exam', resume.courseId],
    });
  }

  const seen = new Set<string>();
  for (const activity of recent) {
    if (items.length >= max) break;
    if (seen.has(activity.module)) continue;
    seen.add(activity.module);
    const label = areaLabel(activity.module);
    if (label) items.push({ label, route: activity.route });
  }
  return items;
}
