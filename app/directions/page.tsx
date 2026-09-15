import { publicPageMetadata } from '../seo';
import { publicSession } from '../server/public-session';
import Link from 'next/link';
import { PublicFooter, PublicHeader } from '../public-chrome';
import { studioRoles } from '../public-content';

const directions = [
  { code: '01', title: 'Съёмка мероприятия', kind: 'event', text: 'Репортаж, фотографии или видео с события университета. Расскажите, какие моменты нужно сохранить.', action: 'Выбрать съёмку мероприятия' },
  { code: '02', title: 'Видеоролик', kind: 'video', text: 'От идеи и сценария до готового видео. Укажите формат и желаемую дату сдачи материала.', action: 'Выбрать видеоролик' },
  { code: '03', title: 'Прямой эфир', kind: 'event', text: 'Откроется заявка на освещение мероприятия. Укажите трансляцию в описании — возможность и условия согласуем отдельно.', action: 'Обсудить трансляцию' },
];

export const metadata = publicPageMetadata('/directions');

export default async function DirectionsPage() {
  const session = await publicSession();
  const directionHref = (kind: string) => session ? session.role === 'management' ? '/management' : `/cabinet?new=1&kind=${kind}` : `/?auth=login&intent=request&kind=${kind}`;
  return <div className="studio-site">
    <PublicHeader active="directions" initialSession={session} />
    <main className="studio-tab-page studio-directions-page" id="public-main">
      <section className="public-directions studio-legacy-directions" aria-labelledby="directions-title">
        <div className="public-section-head">
          <div className="public-section-label"><span>CH 03</span><h1 id="directions-title">Что мы делаем</h1></div>
          <p>Выберите задачу — детали и состав команды уточним после заявки.</p>
        </div>
        <div className="public-direction-grid">{directions.map((direction) => <article key={direction.code}>
          <span>{direction.code}</span>
          <div><h2>{direction.title}</h2><p>{direction.text}</p></div>
          <Link className="public-direction-action" href={directionHref(direction.kind)}>{direction.action}<span aria-hidden="true">→</span></Link>
        </article>)}</div>
      </section>

      <div className="studio-inner-page studio-tab-content">

      <section className="studio-learning-section" aria-labelledby="directions-team-title">
        <div>
          <span>Состав команды</span>
          <h2 id="directions-team-title">Специалисты под задачу</h2>
          <p>В заявке расскажите о мероприятии: дату, место, формат и ожидаемый результат. Команда ГУТВ сама подберёт специалистов под задачу.</p>
        </div>
        <ol>{studioRoles.map((role, index) => <li key={role}><span>{String(index + 1).padStart(2, '0')}</span><b>{role}</b></li>)}</ol>
      </section>

      <section className="studio-request-panel studio-request-panel-inner" aria-labelledby="directions-request-title">
        <div><span>Снять вместе с ГУТВ</span><h2 id="directions-request-title">Есть<br />задача?</h2></div>
        <div><p>Расскажите о мероприятии — дата, место, суть события и ожидаемый результат сохранятся в личном кабинете. Специалистов и технику подберёт ГУТВ.</p><Link href="/?auth=login&intent=request">Оставить заявку <span>→</span></Link></div>
      </section>
      </div>
    </main>
    <PublicFooter />
  </div>;
}
