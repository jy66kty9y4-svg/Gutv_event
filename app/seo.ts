import type { Metadata } from 'next';

export const SITE_URL = 'https://gutv.tech';

export const publicPages = {
  '/': {
    title: 'ГУТВ — студенческое телевидение Губкинского университета',
    description: 'ГУТВ — студенческая телестудия РГУ нефти и газа (НИУ) имени И.М. Губкина. Репортажи, фото, видео, прямые эфиры и заявки на съёмку мероприятий.',
  },
  '/studio': {
    title: 'О студии — ГУТВ',
    description: 'Студенческая телестудия ГУТВ Губкинского университета: команда, руководство, проекты и последние материалы.',
  },
  '/directions': {
    title: 'Направления — ГУТВ',
    description: 'Репортажи, фото и видео, прямые эфиры студенческой телестудии ГУТВ. Съёмка мероприятий Губкинского университета и команда специалистов.',
  },
} as const;

export function publicPageMetadata(path: keyof typeof publicPages): Metadata {
  const { title, description } = publicPages[path];
  const url = new URL(path, SITE_URL).href;

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url,
      siteName: 'ГУТВ',
      locale: 'ru_RU',
      type: 'website',
    },
    twitter: { card: 'summary', title, description },
  };
}
