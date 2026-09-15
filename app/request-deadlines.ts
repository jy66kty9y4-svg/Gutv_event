import type { FilmingBrief } from './filming-brief';
import { validFilmingDate } from './filming-validation';

export function needsDeliveryDate(kind: unknown) { return kind === 'video' || kind === 'event_video'; }
export function deliveryDateError(kind: unknown, value: unknown) {
  if (!needsDeliveryDate(kind)) return null;
  // The delivery field has been removed; validate only dates sent by older clients.
  if (value === '' || value === undefined || value === null) return null;
  return typeof value === 'string' && validFilmingDate(value) ? null : 'Укажите существующую дату сдачи готового видеоматериала';
}

function subtractDays(value: string, days: number) {
  return new Date(new Date(value + 'T12:00:00Z').getTime() - days * 86400000).toISOString().slice(0, 10);
}
function subtractMonths(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10);
}
function pretty(value: string) { return value.split('-').reverse().join('.'); }

// Compare the original submission day in Moscow, never the day of moderation.
export function requestDeadlineWarnings(brief: FilmingBrief | null, submittedAt: string): string[] {
  if (!brief) return ['В старой заявке не указан тип работы: соблюдение сроков нужно проверить вручную.'];
  const timestamp = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(submittedAt) ? submittedAt : submittedAt.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(timestamp.getTime())) return ['Не удалось определить дату подачи заявки. Проверьте сроки вручную.'];
  const submitted = new Date(timestamp.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const firstDate = [...brief.slots].map(slot => slot.startsAt.slice(0, 10)).sort()[0];
  const warnings: string[] = [];
  if (validFilmingDate(firstDate || '') && (brief.requestKind === 'event' || brief.requestKind === 'event_video' || brief.requestKind === 'trip')) {
    const trip = brief.requestKind === 'trip';
    const deadline = trip ? subtractMonths(firstDate, 2) : subtractDays(firstDate, 14);
    if (submitted > deadline) warnings.push(`Пункт ${trip ? '4.3' : '3.1'}: заявку нужно подать за ${trip ? '2 месяца до выезда' : '14 дней до мероприятия'}, не позднее ${pretty(deadline)}. Подана ${pretty(submitted)}.`);
  }
  if (needsDeliveryDate(brief.requestKind) && brief.deliveryDate) {
    if (!brief.deliveryDate || !validFilmingDate(brief.deliveryDate)) warnings.push('Пункт 3.2: не указана дата сдачи готового видеоматериала. Проверить срок 21 день невозможно.');
    else {
      const deadline = subtractDays(brief.deliveryDate, 21);
      if (submitted > deadline) warnings.push(`Пункт 3.2: заявку нужно подать за 21 день до сдачи видеоматериала, не позднее ${pretty(deadline)}. Подана ${pretty(submitted)}.`);
    }
  }
  return warnings;
}
