export interface Lesson {
  id: string;
  title: string;
  duration: string;
  type: 'video' | 'practice' | 'skill-check';
  status: 'new' | 'in-progress' | 'completed' | 'not-attempted';
  contentPath?: string | null;
}

export interface CourseModule {
  id: number;
  title: string;
  lessons: Lesson[];
  expanded: boolean;
}

export interface Course {
  id: string;
  title: string;
  tag: string;
  audience: string;
  moduleCount: number;
  duration: string;
  description: string;
  benefits: string[];
  modules: CourseModule[];
}
