import type { CSSProperties } from 'react';

// The editor and published cards use the same photo viewport.
export const PHOTO_ASPECT_RATIOS = { leadership: 4 / 5, project: 1.55 } as const;

export function photoCoordinates(position: string) {
  const match = position.match(/^([\d.]+)% ([\d.]+)%$/);
  return match ? { x: Number(match[1]), y: Number(match[2]) }
    : { x: 50, y: position === 'center top' ? 0 : position === 'center bottom' ? 100 : 50 };
}

export function leadershipPhotoStyle(person: { photoPosition: string; photoScale?: number }): CSSProperties {
  return { objectPosition: person.photoPosition, transformOrigin: person.photoPosition, transform: `scale(${person.photoScale ?? 1})` };
}
