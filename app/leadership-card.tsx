'use client';
import type { Ref } from 'react';
import type { LeadershipPerson } from './leadership-types';
import PositionedPhoto from './positioned-photo';
import { PHOTO_ASPECT_RATIOS } from './leadership-photo';
import styles from './leadership-card.module.css';

type Props = { person: Omit<LeadershipPerson, 'id'> | null; title: string; index: number; imageRef?: Ref<HTMLImageElement> };

/** One composition for the public carousel and the editor; all sizes follow card width. */
export default function LeadershipCard({ person, title, index, imageRef }: Props) {
  return <article className={styles.card} data-leadership-card>
    <div className={styles.media} style={{ aspectRatio: PHOTO_ASPECT_RATIOS.leadership }}>{person?.photoUrl ? <PositionedPhoto photo={person} alt={person.name} aspectRatio={PHOTO_ASPECT_RATIOS.leadership} className={styles.photo} imageRef={imageRef} />
      : <div className={styles.fallback} aria-hidden="true">{person ? 'ГУТВ' : '+'}</div>}</div>
    <span className={styles.shade} aria-hidden="true" />
    <div className={styles.meta}><small>{String(index + 1).padStart(2, '0')} / {person ? 'ГУТВ' : 'ДОЛЖНОСТЬ'}</small><span aria-hidden="true">{person ? 'ГУТВ' : '+'}</span></div>
    <div className={styles.copy}>
      <h3 className={styles.name}>{person ? person.name : title}</h3>
      {person ? <><b className={styles.role}>{title}</b>{person.description && <p className={styles.description}>{person.description}</p>}</> : <p className={styles.description}>Человек пока не назначен.</p>}
    </div>
  </article>;
}
