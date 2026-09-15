export type StudioStory = {
  date: string;
  category: string;
  title: string;
  description: string;
  href: string;
  image?: string;
  imageAlt?: string;
  imageCrop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
  };
  duration?: string;
  source: 'telegram' | 'vk';
};

export const socialLinks = {
  telegram: 'https://t.me/gutv_official',
  vk: 'https://vk.ru/gutv_official',
};

export const stories: StudioStory[] = [
  {
    date: '01 сентября',
    category: 'О студии',
    title: 'Что такое ГУТВ',
    description: 'Студенческая телестудия Губкинского университета — о событиях, людях и жизни вуза без постановочной дистанции.',
    href: 'https://t.me/gutv_official/1878',
    image: '/media/live-control.webp',
    imageAlt: 'Режиссёрская аппаратная во время трансляции ГУТВ',
    source: 'telegram',
  },
  {
    date: '25 августа',
    category: 'Лето с ГУТВ',
    title: 'Лето с ГУТВ: Влад',
    description: 'Личная летняя хроника участника студии — жизнь команды продолжается и за пределами съёмочной площадки.',
    href: 'https://t.me/gutv_official/1869',
    source: 'telegram',
  },
  {
    date: '18 августа',
    category: 'Лето с ГУТВ',
    title: 'Семён и Яна',
    description: 'Ещё одна история из серии о путешествиях, впечатлениях и людях внутри ГУТВ.',
    href: 'https://t.me/gutv_official/1859',
    source: 'telegram',
  },
  {
    date: '12 августа',
    category: 'Лето с ГУТВ',
    title: 'Калининград',
    description: 'Летний дневник студии: новый город, наблюдения и кадры, которые хочется сохранить.',
    href: 'https://t.me/gutv_official/1849',
    source: 'telegram',
  },
  {
    date: '31 июля',
    category: 'Лето с ГУТВ',
    title: 'Город контрастов',
    description: 'Продолжение сезонной серии ГУТВ — короткие истории участников студии от первого лица.',
    href: 'https://t.me/gutv_official/1840',
    source: 'telegram',
  },
  {
    date: 'Из архива',
    category: 'Люди',
    title: 'Последняя перебивка',
    description: 'Материал о выпускниках студии — с благодарностью людям, которые оставили в ГУТВ свой след.',
    href: 'https://t.me/gutv_official/1839',
    source: 'telegram',
  },
];

export const archiveHighlights = [
  { title: 'День Губкинца 2026', text: 'Закулисье и работа большой университетской трансляции.' },
  { title: 'Взлёт 9.0: от края до края', text: 'Выезд, обучение и команда ГУТВ в одном материале.' },
  { title: 'Геолучье 6.0', text: 'Событие университета глазами студенческого телевидения.' },
  { title: 'Концерт ко Дню Победы', text: 'Постановочная и съёмочная работа команды ГУТВ.' },
];

export const studioFormats = [
  {
    title: 'События',
    text: 'Репортажи, интервью и фотоистории с главных событий университета.',
    marker: 'REPORT',
  },
  {
    title: 'За сценой',
    text: 'То, что обычно остаётся вне кадра: подготовка, люди и работа команды.',
    marker: 'BACKSTAGE',
  },
  {
    title: 'Свои проекты',
    text: 'От коротких роликов и клипов до документальных историй и специальных форматов.',
    marker: 'ORIGINALS',
  },
  {
    title: 'Прямой эфир',
    text: 'Многокамерные трансляции, режиссура эфира, звук и графика на площадке.',
    marker: 'LIVE',
  },
];

export const studioRoles = [
  'Режиссёры',
  'Операторы',
  'Монтажёры',
  'Фотографы',
  'Корреспонденты',
  'Специалисты прямого эфира',
];

export const studioTeam = [
  {
    name: 'Djemil Gadji',
    role: 'Директор ГУТВ',
    initials: 'DG',
    image: '/media/team.webp',
    imageAlt: 'Команда студенческой телестудии ГУТВ',
    imagePosition: '52% 42%',
  },
  {
    name: 'Алексей Малинин',
    role: 'Заместитель директора ГУТВ',
    initials: 'АМ',
    image: '/media/live-control.webp',
    imageAlt: 'Работа команды ГУТВ в режиссёрской аппаратной',
    imagePosition: '56% 50%',
  },
  {
    name: 'Максим Борисов',
    role: 'Технический директор',
    initials: 'МБ',
    image: '/media/on-set.webp',
    imageAlt: 'Съёмочная группа ГУТВ на площадке',
    imagePosition: '76% 52%',
  },
  {
    name: 'Emir Adelshin',
    role: 'Шеф-редактор',
    initials: 'EA',
    image: '/media/team.webp',
    imageAlt: 'Команда студенческой телестудии ГУТВ',
    imagePosition: '31% 38%',
  },
  {
    name: 'Семён Семенов',
    role: 'Внешние связи',
    initials: 'СС',
    image: '/media/team.webp',
    imageAlt: 'Команда студенческой телестудии ГУТВ',
    imagePosition: '78% 40%',
  },
];
