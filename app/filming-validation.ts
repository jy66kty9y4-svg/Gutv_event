// Booking dates and times are always interpreted in the studio's Moscow time zone.
const moscowDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function filmingDateBounds(now = new Date()) {
  const parts = moscowDate.formatToParts(now);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value);
  const year = part('year'), month = part('month'), day = part('day');
  const targetMonth = new Date(Date.UTC(year, month - 1 + 6, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    min: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    max: new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10),
  };
}

export function validFilmingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validFilmingTime(value: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }

export function filmingScheduleError(date: string, start: string, end: string, now = new Date()) {
  if (!validFilmingDate(date)) return 'Укажите существующую дату съёмки';
  const bounds = filmingDateBounds(now);
  if (date < bounds.min) return 'Нельзя подать заявку на прошедшую дату';
  if (date > bounds.max) return 'Заявку можно подать не более чем на 6 месяцев вперёд';
  if (!validFilmingTime(start) || !validFilmingTime(end)) return 'Укажите время начала и окончания съёмки';
  if (end <= start) return 'Время окончания должно быть позже времени начала';
  if (new Date(`${date}T${start}:00+03:00`).getTime() <= now.getTime()) return 'Время начала съёмки уже прошло (московское время)';
  return null;
}
