export type RequestedSpecialist = { id: number; requestedCount: number };

export function requestedSpecialistsError(kind: unknown, value: unknown, activeIds: number[]) {
  if (!Array.isArray(value)) return 'Проверьте список специалистов';
  if (kind !== 'trip') return value.length ? 'Специалисты запрашиваются только для выездной учёбы' : null;
  if (!value.length) return 'Выберите хотя бы одного специалиста для выездной учёбы';
  if (value.length > activeIds.length) return 'Проверьте список специалистов';
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.id) || !activeIds.includes(item.id) || seen.has(item.id)) return 'Выберите специалистов из доступного списка';
    if (!Number.isInteger(item.requestedCount) || item.requestedCount < 1 || item.requestedCount > 99) return 'Количество каждого специалиста — целое число от 1 до 99';
    seen.add(item.id);
  }
  return null;
}

export function readRequestedSpecialists(form: FormData): RequestedSpecialist[] {
  if (form.get('requestKind') !== 'trip') return [];
  return form.getAll('specialtyId').map(id => ({ id: Number(id), requestedCount: Number(form.get(`specialtyCount-${id}`)) }));
}
