import { filmingDateBounds, validFilmingDate, validFilmingTime } from './filming-validation';
import { participantsError } from './participants-validation';

export const requestKinds = {
  event: 'Освещение мероприятия',
  video: 'Создание контента',
  event_video: 'Мероприятие и контент',
  trip: 'Выездная учёба',
} as const;
export type RequestKind = keyof typeof requestKinds;
export type FilmingSlot = { startsAt: string; endsAt: string; location: string };
export type FilmingBrief = { requestKind: RequestKind; scenario: string; participants: string; rulesAcceptedAt: string; slots: FilmingSlot[]; deliveryDate?: string };
export const maxFilmingSlots = 12;

export function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && Object.hasOwn(requestKinds, value);
}
export function briefTextError(kind: unknown, scenario: unknown, participants: unknown) {
  if (!isRequestKind(kind)) return 'Выберите, что нужно подготовить';
  if (typeof scenario !== 'string' || scenario.trim().length < 10 || scenario.length > 4000) return 'План мероприятия или сценарий: от 10 до 4000 символов';
  return participantsError(participants);
}
export function filmingSlotsError(value: unknown, now = new Date(), previous: FilmingSlot[] = []): string | null {
  if (!Array.isArray(value) || !value.length || value.length > maxFilmingSlots) return `Добавьте от 1 до ${maxFilmingSlots} интервалов съёмки`;
  const bounds = filmingDateBounds(now);
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const prefix = `Интервал ${index + 1}: `;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return prefix + 'проверьте дату, время и место';
    const { startsAt, endsAt, location } = item as Record<string, unknown>;
    for (const moment of [startsAt, endsAt]) {
      if (typeof moment !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(moment) || !validFilmingDate(moment.slice(0, 10)) || !validFilmingTime(moment.slice(11))) return prefix + 'укажите существующие дату и время';
    }
    const start = startsAt as string, end = endsAt as string;
    if (end <= start) return prefix + 'окончание должно быть позже начала';
    if (typeof location !== 'string' || location.trim().length < 2 || location.length > 240) return prefix + 'место проведения — от 2 до 240 символов';
    const unchanged = previous.some(slot => slot.startsAt === start && slot.endsAt === end);
    if (!unchanged) {
      if (start.slice(0, 10) < bounds.min || new Date(start + ':00+03:00').getTime() <= now.getTime()) return prefix + 'время начала уже прошло (Москва)';
      if (start.slice(0, 10) > bounds.max || end.slice(0, 10) > bounds.max) return prefix + 'даты доступны не более чем на 6 месяцев вперёд';
    }
    const key = `${start}|${end}|${location.trim().toLocaleLowerCase('ru-RU')}`;
    if (seen.has(key)) return prefix + 'такая дата и площадка уже добавлены';
    seen.add(key);
  }
  return null;
}
export function normalizeFilmingSlots(value: FilmingSlot[]) {
  return value.map(slot => ({ startsAt: slot.startsAt, endsAt: slot.endsAt, location: slot.location.trim() }));
}
export function readFilmingSlots(form: FormData): FilmingSlot[] {
  const starts = form.getAll('slotStart'), ends = form.getAll('slotEnd'), places = form.getAll('slotLocation');
  return starts.map((start, index) => ({ startsAt: String(start), endsAt: String(ends[index] || ''), location: String(places[index] || '') }));
}
