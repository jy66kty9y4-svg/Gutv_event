const $ = (selector) => document.querySelector(selector);
const dialog = $('#auth-dialog');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = 'light';

function navigate() {
  const target = location.hash.slice(1).split('/')[0];
  const page = ['home', 'studio', 'directions'].includes(target) ? target : 'home';
  document.querySelectorAll('.page').forEach((element) => { element.hidden = element.id !== page; });
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#footer').hidden = page === 'home';
  $('#service-line').hidden = page === 'home';
  document.title = `${{home:'Главная',studio:'О студии',directions:'Направления'}[page]} — ГУТВ · макет`;
  if (location.hash === '#studio/latest') $('.latest-section').scrollIntoView();
  else window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', navigate);
navigate();

function setTheme(mode) {
  themeMode = mode;
  document.documentElement.dataset.theme = mode === 'auto' ? (systemDark.matches ? 'dark' : 'light') : mode;
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === mode)));
}
systemDark.addEventListener('change', () => { if (themeMode === 'auto') setTheme('auto'); });

function showDialog(mode) {
  const register = mode === 'register';
  $('#register-content').hidden = !register;
  $('#login-content').hidden = register;
  dialog.classList.toggle('register-mode', register);
  dialog.setAttribute('aria-labelledby', register ? 'register-title' : 'dialog-title');
  $('#login-description').textContent = mode === 'request' ? 'Войдите в личный кабинет, чтобы оставить заявку на съёмку.' : 'Введите логин и пароль вашей учётной записи.';
  $('.preview-note').textContent = 'Макет: данные не отправляются.';
  if (!dialog.open) dialog.showModal();
  document.body.style.overflow = 'hidden';
  (register ? $('#register-content select') : $('#login-content input')).focus();
}
dialog.addEventListener('close', () => { document.body.style.overflow = ''; });
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
document.addEventListener('click', (event) => {
  if (event.target.closest('.skip')) {
    event.preventDefault();
    $('#main').focus();
    $('#main').scrollIntoView();
    return;
  }
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.dialog) showDialog(target.dataset.dialog);
  if (target.classList.contains('close-dialog')) dialog.close();
  if (target.dataset.themeChoice) setTheme(target.dataset.themeChoice);
  if (target.dataset.scroll) {
    const list = document.getElementById(target.dataset.scroll);
    list.scrollBy({left: Number(target.dataset.step) * (list.firstElementChild.getBoundingClientRect().width + 22), behavior: motion.matches ? 'instant' : 'smooth'});
  }
});
document.querySelectorAll('.preview-form').forEach((form) => form.addEventListener('submit', (event) => {
  event.preventDefault();
  $('.preview-note').textContent = 'Это просмотр нового дизайна. Вход и отправка данных здесь не подключены.';
}));

// Only public display content is read. Preview forms never make a network request.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function photo(src, alt) {
  const img = el('img'); img.src = src; img.alt = alt; img.loading = 'lazy'; return img;
}
function externalLink(href, className) {
  const a = el('a', className); a.href = href; a.target = '_blank'; a.rel = 'noreferrer'; return a;
}
fetch('data.json').then((response) => { if (!response.ok) throw new Error('Контент недоступен'); return response.json(); }).then((data) => {
  data.leadership.forEach((person) => {
    const card = el('article', 'person-card');
    const portrait = el('div', 'portrait');
    portrait.style.setProperty('--photo-position', person.photoPosition || 'center');
    portrait.style.setProperty('--photo-scale', String(person.photoScale || 1));
    const cross = el('span', 'photo-cross', '+'); cross.setAttribute('aria-hidden', 'true');
    portrait.append(photo(person.image, person.name), cross);
    card.append(portrait, el('h3', '', person.name), el('p', 'role', person.role));
    $('#team-list').append(card);
  });
  data.projects.forEach((project) => {
    const card = externalLink(project.href, 'project-card');
    if (project.image) card.append(photo(project.image, project.title));
    card.append(el('p', 'eyebrow', project.eyebrow), el('h3', '', project.title), el('p', '', project.description));
    const cta = el('div', 'project-cta', project.linkLabel); cta.append(el('span', '', '↗')); card.append(cta);
    $('#project-list').append(card);
  });
  data.latest.forEach((project) => {
    const card = externalLink(project.href, 'latest-card');
    const frame = el('div', 'latest-image');
    if (project.imageCrop) {
      const crop = project.imageCrop;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.width} ${crop.height}`);
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', project.imageAlt);
      const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      img.setAttribute('href', project.image); img.setAttribute('width', crop.sourceWidth); img.setAttribute('height', crop.sourceHeight);
      svg.append(img); frame.append(svg);
    } else frame.append(photo(project.image, project.imageAlt));
    frame.append(el('span', 'duration', project.duration));
    card.append(frame, el('p', 'eyebrow', 'VK · ГУТВ'), el('h3', '', project.title), el('p', '', project.description), el('span', 'text-link', 'Открыть в VK ↗'));
    $('#latest-list').append(card);
  });
}).catch(() => { $('#team-list').append(el('p', '', 'Не удалось загрузить материалы. Обновите страницу.')); });
