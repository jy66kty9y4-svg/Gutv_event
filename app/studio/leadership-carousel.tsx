'use client';


import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { PublicLeadershipCard } from '../leadership-types';
import LeadershipCard from '../leadership-card';

type LeadershipCarouselProps = { cards: PublicLeadershipCard[] };

export default function LeadershipCarousel({ cards }: LeadershipCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  function scroll(direction: -1 | 1) {
    const track = trackRef.current;
    const firstCard = track?.querySelector<HTMLElement>('article');
    if (!track || !firstCard) return;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
    track.scrollBy({ left: direction * (firstCard.offsetWidth + gap), behavior: 'smooth' });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    scroll(event.key === 'ArrowRight' ? 1 : -1);
  }

  return <section className="home-leadership" aria-labelledby="studio-leadership-title">
    <div className="home-leadership-head">
      <div><span>Команда / управление</span><h2 id="studio-leadership-title">Руководящий состав</h2></div>
      <div className="home-leadership-controls" aria-label="Управление каруселью">
        <button type="button" onClick={() => scroll(-1)} aria-label="Предыдущая позиция">←</button>
        <button type="button" onClick={() => scroll(1)} aria-label="Следующая позиция">→</button>
      </div>
    </div>
    <div className="home-leadership-track" ref={trackRef} aria-label="Руководящий состав ГУТВ" tabIndex={0} onKeyDown={handleKeyDown}>
      {cards.map((card, index) => <LeadershipCard key={card.id} person={card.person} title={card.title} index={index} />)}
    </div>
  </section>;
}
