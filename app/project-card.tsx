import type { Ref } from 'react';
import type { ProjectDraft } from './project-types';
import PositionedPhoto from './positioned-photo';
import { PHOTO_ASPECT_RATIOS } from './leadership-photo';
import styles from './project-card.module.css';
export default function ProjectCard({ project, preview = false, compact = false, imageRef }: { project: ProjectDraft; preview?: boolean; compact?: boolean; imageRef?: Ref<HTMLImageElement> }) {
  return <article className={`${styles.card} ${styles[project.tone]} ${project.photoUrl ? styles.withPhoto : ''} ${compact ? styles.compact : ''}`} data-project-card>
    {project.photoUrl && <div className={styles.media} style={{ aspectRatio: PHOTO_ASPECT_RATIOS.project }}><PositionedPhoto photo={project} alt={project.title} aspectRatio={PHOTO_ASPECT_RATIOS.project} className={styles.photo} imageRef={imageRef} /><span className={styles.shade} /></div>}
    <div className={styles.copy}><small>{project.eyebrow}</small><h3>{project.title || 'Название проекта'}</h3>{project.description && <p>{project.description}</p>}{project.url && <b>{project.linkLabel || 'Открыть проект'} ↗</b>}</div>
    {!preview && project.url && <a className={styles.link} href={project.url} target="_blank" rel="noopener noreferrer" aria-label={project.title} />}
  </article>;
}
