// Initial roster from the user-supplied workbook «Рук состав гутв.xlsx».
// Positions and their order follow the user's accompanying message.
// Import once: later administrative edits must never be overwritten by this seed.
export const leadershipSeed = {
  version: 'workbook-2026-09-05-v1',
  people: [
    { id: 1, name: 'Адельшин Джемильхан', description: '', photoUrl: '/media/leadership/adelshin-dzhemilkhan.webp', photoPosition: 'center center' },
    { id: 2, name: 'Харитонов Никита', description: '', photoUrl: '/media/leadership/kharitonov-nikita.webp', photoPosition: 'center center' },
    { id: 3, name: 'Семенов Семён', description: '', photoUrl: '/media/leadership/semenov-semyon.webp', photoPosition: 'center top' },
  ],
  positions: [
    { title: 'Директор', personId: 1 },
    { title: 'Заместитель директора', personId: null },
    { title: 'Технический директор', personId: null },
    { title: 'Шеф-редактор', personId: null },
    { title: 'Заместитель по внешним связям', personId: 3 },
    { title: 'Видео-контент на концертах', personId: 2 },
  ],
} as const;
