import type { StudioStory } from './public-content';

export const VK_REFERENCE_GROUP_ID = 30973272;
export const VK_REFERENCE_CAPTURED_AT = 1_788_613_554;

export type VkReferencePost = Omit<StudioStory, 'source' | 'category'> & {
  postId: number;
  text: string;
};

export const vkReferencePosts: VkReferencePost[] = [
  {
    postId: 6873,
    date: '',
    title: 'Мало 6.0',
    text: 'Откуда звук? 🎼\n\nМне тебя мало — мало-мало-мало вайба в том, что лето неумолимо заканчивается. Но Сгшье 6.0 согреет воспоминаниями, которые запечатлены в клипе "Мало 6.0" — надеваем наушники и погружаемся в незабываемую атмосферу! 🎧',
    description: '',
    href: 'https://vk.ru/wall-30973272_6873',
    image: '/media/vk-reference/6873.webp',
    imageAlt: 'Кадр из клипа «Мало 6.0»',
    imageCrop: { x: 2, y: 122, width: 1102, height: 621, sourceWidth: 1104, sourceHeight: 1070 },
    duration: '3:01',
  },
  {
    postId: 6869,
    date: '',
    title: 'Александр Катович, 2026',
    text: 'Каждый кадр Саши Катовича — отдельная вселенная. А все ведь начиналось со старого фотоаппарата. Да что писать, если все это есть в замечательной перебивке? 💥📷',
    description: '',
    href: 'https://vk.ru/wall-30973272_6869',
    image: '/media/vk-reference/6869.webp',
    imageAlt: 'Кадр из перебивки об Александре Катовиче',
    imageCrop: { x: 0, y: 129, width: 1102, height: 620, sourceWidth: 1102, sourceHeight: 914 },
    duration: '2:21',
  },
  {
    postId: 6866,
    date: '',
    title: 'Лиза Смирнова',
    text: 'А как все началось? Этот вопрос задали и Лизе Смирновой. Ответ прост — спонтанно. Но насколько это "спонтанно" было удачным! Перебивка не даст соврать 😉',
    description: '',
    href: 'https://vk.ru/wall-30973272_6866',
    image: '/media/vk-reference/6866.webp',
    imageAlt: 'Кадр из перебивки о Лизе Смирновой',
    imageCrop: { x: 0, y: 144, width: 1104, height: 621, sourceWidth: 1104, sourceHeight: 932 },
    duration: '2:43',
  },
  {
    postId: 6862,
    date: '30 июля',
    title: 'Надежда Федякова',
    text: '"До скорой встречи!" — именно так хочется сказать Наде Федяковой, ведь мы будем скучать по ней. Она стала действительно незаменимым человеком в нашей команде, о чем и перебивка. Приятного просмотра! 💻',
    description: '',
    href: 'https://vk.ru/wall-30973272_6862',
    image: '/media/vk-reference/6862.webp',
    imageAlt: 'Кадр из перебивки о Надежде Федяковой',
    imageCrop: { x: 0, y: 124, width: 1098, height: 621, sourceWidth: 1098, sourceHeight: 976 },
    duration: '2:18',
  },
  {
    postId: 6855,
    date: '30 июля',
    title: 'Дима Петров',
    text: 'Чуть-чуть стеснительный, но всегда веселый. Таков Дима Петров — слон, оператор и просто замечательный человек. Возьмем вместе с ним камеру и пройдемся по знакомым улицам? 📹',
    description: '',
    href: 'https://vk.ru/wall-30973272_6855',
    image: '/media/vk-reference/6855.webp',
    imageAlt: 'Кадр из перебивки о Диме Петрове',
    imageCrop: { x: 0, y: 141, width: 1102, height: 620, sourceWidth: 1102, sourceHeight: 982 },
    duration: '2:53',
  },
];
