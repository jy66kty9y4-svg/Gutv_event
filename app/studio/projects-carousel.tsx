'use client';

import ProjectCard from '../project-card';
import type { StudioProject } from '../project-types';
import { useRef } from 'react';

export default function ProjectsCarousel({ projects }: { projects: StudioProject[] }) {
  const trackRef = useRef<HTMLDivElement>(null);

  function scroll(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-project-card]');
    const gap = Number.parseFloat(window.getComputedStyle(track).gap) || 0;
    const step = card ? card.getBoundingClientRect().width + gap : track.clientWidth * 0.82;
    track.scrollBy({
      left: direction * step,
      behavior: 'smooth',
    });
  }

  return <section className="studio-projects studio-projects-inner" id="projects" aria-labelledby="studio-projects-title">
    <div className="studio-projects-head">
      <div className="studio-section-heading">
        <div>Избранное / проекты</div>
        <h2 id="studio-projects-title">Наши проекты</h2>
        <p>Собственные форматы ГУТВ и истории, которые продолжаются за пределами одного события.</p>
      </div>
      <div className="home-leadership-controls studio-project-controls" aria-label="Управление каруселью проектов">
        <button type="button" onClick={() => scroll(-1)} aria-label="Предыдущие проекты">←</button>
        <button type="button" onClick={() => scroll(1)} aria-label="Следующие проекты">→</button>
      </div>
    </div>

    <div className="studio-project-carousel-track" ref={trackRef} aria-label="Проекты ГУТВ">
      {projects.map(project => <ProjectCard key={project.id} project={project} />)}
    </div>
  </section>;
}
