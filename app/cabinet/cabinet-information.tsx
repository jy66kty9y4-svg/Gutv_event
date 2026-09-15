import { rulesSections } from './rules-content';

export function CabinetRules() {
  return <div className="cabinet-information">
    <section className="portal-panel"><h2>Правила работы со студией</h2><p>Для председателей и представителей советов обучающихся факультетов, руководителей и представителей студенческих объединений и организаций.</p>
      <h3>Сроки подачи и рассмотрения</h3>
      <dl className="rules-deadlines"><div><dt>14 дней</dt><dd>до мероприятия — заявка на освещение</dd></div><div><dt>21 день</dt><dd>до сдачи готового видеоконтента</dd></div><div><dt>2 месяца</dt><dd>до выездной учёбы — заявка на участие ГУТВ</dd></div><div><dt>1 месяц</dt><dd>до выезда — перечень необходимого контента</dd></div><div><dt>3 рабочих дня</dt><dd>рассмотрение заявки с момента поступления</dd></div></dl>
      <p>Съёмка ведётся в горизонтальном формате. Сроки подготовки готовых материалов и состав выездной группы определяет директор ГУТВ.</p>
    </section>
    {rulesSections.map(section => <section className="portal-panel" key={section.id} id={section.id}><h2>{section.title}</h2><ol className="rules-points">{section.rules.map(rule => <li id={rule.id} key={rule.id}><b>{rule.number}</b><div>{rule.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></li>)}</ol></section>)}
  </div>;
}
function ContactIcon({ kind }: { kind: 'person' | 'telegram' | 'bug' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'person' && <><circle cx="12" cy="7" r="3.5" /><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2" /></>}
    {kind === 'telegram' && <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>}
    {kind === 'bug' && <><path d="m8 2 2 3m6-3-2 3M7 9V8a5 5 0 0 1 10 0v1M12 9v13" /><rect x="6" y="9" width="12" height="13" rx="6" /><path d="m3 6 3 3M2 13h4m-3 8 4-3m14-12-3 3m4 4h-4m3 8-4-3" /></>}
  </svg>;
}
function ContactCard({ role, name, handle }: { role?: string; name: string; handle: string }) {
  return <article className="cabinet-contact-card">
    {role && <h3>{role}</h3>}
    <p className="cabinet-contact-person"><ContactIcon kind="person" /><span>{name}</span></p>
    <a className="cabinet-contact-telegram" href={`https://t.me/${handle}`} target="_blank" rel="noreferrer"><ContactIcon kind="telegram" /><span>@{handle}</span></a>
  </article>;
}
export function CabinetContacts() {
  return <section className="portal-panel cabinet-contacts" aria-labelledby="cabinet-contacts-title">
    <h2 id="cabinet-contacts-title">Контакты для связи</h2>
    <div className="cabinet-contact-stack">
      <ContactCard role="Директор студии" name="Адельшин Джемильхан" handle="pzr_enjoyer" />
      <ContactCard role="Технический директор" name="Борисов Максим" handle="mspieler" />
    </div>
    <section className="cabinet-bug-contact" aria-labelledby="cabinet-bug-title">
      <h2 id="cabinet-bug-title"><ContactIcon kind="bug" />Нашли баг?</h2>
      <ContactCard name="Петров Дмитрий" handle="s1ash2k" />
    </section>
  </section>;
}
