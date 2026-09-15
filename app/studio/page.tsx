import { publicPageMetadata } from '../seo';
import { publicSession } from '../server/public-session';
import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../public-chrome';
import { publicLeadershipCards } from '../server/leadership';
import LeadershipCarousel from './leadership-carousel';
import LatestProjects from './latest-projects';
import ProjectsCarousel from './projects-carousel';
import { studioProjects } from '../server/projects';

export const dynamic = 'force-dynamic';

export const metadata = publicPageMetadata('/studio');

export default async function StudioPage() {
  const leadershipCards = await publicLeadershipCards();

  return <div className="studio-site">
    <PublicHeader active="studio" initialSession={await publicSession()} />
    <main className="studio-tab-page" id="public-main">
      <section className="public-about studio-legacy-about" aria-labelledby="studio-about-title">
        <div className="public-section-label"><span>CH 02</span><b>О студии</b></div>
        <div className="public-about-copy">
          <h1 id="studio-about-title">Мы превращаем жизнь университета в истории, которые хочется пересматривать.</h1>
          <p>ГУТВ объединяет людей, которым близки съёмка, звук, монтаж и прямой эфир. Мы работаем с факультетами и организациями — от первой идеи до готового материала.</p>
        </div>
        <div className="public-about-note"><span>НАША ЗАДАЧА</span><p>Увидеть смысл события и передать его точно — живо, бережно и профессионально.</p></div>
      </section>

      <LeadershipCarousel cards={leadershipCards} />

      <div className="studio-inner-page studio-tab-content">
      <ProjectsCarousel projects={studioProjects()} />
      <LatestProjects />

      <section className="studio-request-panel studio-request-panel-inner" aria-labelledby="studio-about-request-title">
        <div><span>Снять вместе с ГУТВ</span><h2 id="studio-about-request-title">Расскажите<br />о событии</h2></div>
        <div><p>Факультеты и организации могут оставить заявку на съёмку и следить за её статусом в личном кабинете.</p><Link href="/?auth=login&intent=request">Оставить заявку <span>→</span></Link></div>
      </section>
      </div>
    </main>
    <PublicFooter />
  </div>;
}
