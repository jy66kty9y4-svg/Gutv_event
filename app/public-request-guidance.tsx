import Link from 'next/link';
import { rulesSections } from './cabinet/rules-content';

// These contacts are already published in the cabinet contact directory.
export const publicSupport = {
  registration: { name: 'Адельшин Джемильхан', role: 'Директор студии', handle: 'pzr_enjoyer', href: 'https://t.me/pzr_enjoyer' },
  technical: { name: 'Петров Дмитрий', role: 'Помощь с сайтом', handle: 's1ash2k', href: 'https://t.me/s1ash2k' },
};

export function PublicRequestGuidance() {
  return <section className="public-guidance" id="request-guide" aria-labelledby="request-guide-title">
    <div className="public-content-heading"><span>Перед первой заявкой</span><h2 id="request-guide-title">Как организовать съёмку</h2><p>Кабинет предназначен для представителей советов обучающихся факультетов и студенческих организаций Губкинского университета.</p></div>
    <ol className="public-process-steps">
      <li><span aria-hidden="true">1</span><div><h3>Создайте кабинет</h3><p>Один аккаунт на факультет или организацию. ГУТВ проверит данные; до подтверждения вход будет недоступен.</p></div></li>
      <li><span aria-hidden="true">2</span><div><h3>Расскажите о задаче</h3><p>Подготовьте дату, время, место, план мероприятия или сценарий, количество участников и ожидаемый результат.</p></div></li>
      <li><span aria-hidden="true">3</span><div><h3>Согласуйте съёмку</h3><p>Статус заявки и уточнения появятся в кабинете. Состав команды и сроки подготовки материала определит ГУТВ.</p></div></li>
    </ol>
    <div className="public-rules-summary" id="public-rules">
      <h3>Когда подавать заявку</h3>
      <dl><div><dt>За 14 дней</dt><dd>до мероприятия</dd></div><div><dt>За 21 день</dt><dd>до сдачи видеоролика</dd></div><div><dt>За 2 месяца</dt><dd>до выездной учёбы</dd></div></dl>
      <p>Рассмотрение заявки на съёмку — 3 рабочих дня. Съёмка ведётся в горизонтальном формате. Для выездной учёбы перечень контента нужен за месяц до выезда.</p>
      <details className="public-full-rules"><summary>Полные правила работы со студией</summary><div>{rulesSections.map(section => <section key={section.id}><h3>{section.title}</h3><ol>{section.rules.map(rule => <li key={rule.id}><b>{rule.number}</b><div>{rule.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></li>)}</ol></section>)}</div></details>
    </div>
    <Link className="public-inline-link" href="/?auth=register">Создать кабинет <span aria-hidden="true">→</span></Link>
  </section>;
}

export function PublicContacts() {
  return <section className="public-contacts" id="contacts" aria-labelledby="public-contacts-title">
    <div className="public-content-heading"><span>Связь с ГУТВ</span><h2 id="public-contacts-title">Поможем с заявкой и доступом</h2><p>Если забыли пароль или хотите уточнить статус регистрации, напишите директору студии и укажите свой логин или название организации.</p></div>
    <div className="public-contact-links">{Object.values(publicSupport).map(contact => <a key={contact.handle} href={contact.href} target="_blank" rel="noopener noreferrer"><span>{contact.role}</span><strong>{contact.name}</strong><span>@{contact.handle} <b aria-hidden="true">↗</b></span></a>)}</div>
  </section>;
}
