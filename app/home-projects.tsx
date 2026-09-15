'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { StudioStory } from './public-content';
import styles from './home-projects.module.css';

export default function HomeProjects({ projects }: { projects: StudioStory[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ overflow: false, atStart: true, atEnd: false });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    function updatePosition() {
      if (!track) return;
      const maximum = track.scrollWidth - track.clientWidth;
      const next = {
        overflow: maximum > 2,
        atStart: track.scrollLeft <= 2,
        atEnd: track.scrollLeft >= maximum - 2,
      };
      setPosition(previous => previous.overflow === next.overflow && previous.atStart === next.atStart && previous.atEnd === next.atEnd ? previous : next);
    }

    const frame = window.requestAnimationFrame(updatePosition);
    const observer = new ResizeObserver(updatePosition);
    observer.observe(track);
    for (const card of track.children) observer.observe(card);
    track.addEventListener('scroll', updatePosition, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      track.removeEventListener('scroll', updatePosition);
    };
  }, [projects]);

  function scroll(direction: -1 | 1) {
    const track = trackRef.current;
    const card = track?.firstElementChild;
    if (!track || !card) return;
    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
    track.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      scroll(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      trackRef.current?.scrollTo({ left: event.key === 'Home' ? 0 : trackRef.current.scrollWidth, behavior: 'instant' });
    }
  }

  if (projects.length === 0) return null;

  return <section className={styles.section} id="latest-projects" aria-labelledby="latest-projects-title">
    <header className={styles.heading}>
      <div>
        <h2 id="latest-projects-title">Последние работы</h2>
        <p>События, люди и истории в кадре ГУТВ.</p>
      </div>
      {position.overflow && projects.length > 1 && <div className={styles.controls} aria-label="Управление каруселью проектов">
        <button type="button" onClick={() => scroll(-1)} disabled={position.atStart} aria-label="Предыдущие проекты" aria-controls="home-projects-track">←</button>
        <button type="button" onClick={() => scroll(1)} disabled={position.atEnd} aria-label="Следующие проекты" aria-controls="home-projects-track">→</button>
      </div>}
    </header>
    <div className={styles.track} ref={trackRef} id="home-projects-track" role="group" aria-label="Проекты ГУТВ" tabIndex={position.overflow ? 0 : -1} onKeyDown={handleKeyDown}>
      {projects.map(project => <article className={styles.card} data-latest-work key={project.href}>
        <a className={styles.cardLink} href={project.href} target="_blank" rel="noopener noreferrer">
          <div className={styles.media}>
            {project.image ? project.imageCrop
              ? <svg className={styles.image} viewBox={`${project.imageCrop.x} ${project.imageCrop.y} ${project.imageCrop.width} ${project.imageCrop.height}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={project.imageAlt || project.title}>
                <image href={project.image} width={project.imageCrop.sourceWidth} height={project.imageCrop.sourceHeight} preserveAspectRatio="xMidYMid meet" />
              </svg>
              : <img className={styles.image} src={project.image} alt={project.imageAlt || ''} loading="lazy" referrerPolicy={project.source === 'vk' ? 'no-referrer' : undefined} />
              : <span className={styles.placeholder}>ГУТВ</span>}
            {project.duration && <>
              <span className={styles.play} aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m9 5 11 7-11 7z" /></svg></span>
              <span className={project.imageCrop ? styles.srOnly : styles.duration} aria-label={`Длительность видео ${project.duration}`}>{project.duration}</span>
            </>}
          </div>
          <div className={styles.copy}>
            <div className={styles.meta}><span>{project.source === 'vk' ? 'VK' : 'Telegram'} · ГУТВ</span>{project.date && <span>{project.date}</span>}</div>
            <h3>{project.title}</h3>
            {project.description && <p>{project.description}</p>}
            <span className={styles.open}>{project.duration ? 'Смотреть ролик' : 'Открыть материал'} <span aria-hidden="true">↗</span></span>
          </div>
        </a>
      </article>)}
    </div>
  </section>;
}
