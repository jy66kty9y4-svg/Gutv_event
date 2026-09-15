import type { LeadershipPhotoPosition } from './leadership-types';
export type StudioProject = { id: number; title: string; eyebrow: string; description: string; url: string; linkLabel: string; photoUrl: string; photoPosition: LeadershipPhotoPosition; photoScale: number; tone: 'dark' | 'blue' | 'light'; sortOrder: number };
export type ProjectDraft = Omit<StudioProject, 'id' | 'sortOrder'>;
