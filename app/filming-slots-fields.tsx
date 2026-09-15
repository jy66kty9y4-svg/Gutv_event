'use client';
import { useRef, useState } from 'react';
import { filmingDateBounds } from './filming-validation';
import { maxFilmingSlots, type FilmingSlot } from './filming-brief';

export default function FilmingSlotsFields({ initialSlots = [], allowHistorical = false, onSlotsChange }: { initialSlots?: FilmingSlot[]; allowHistorical?: boolean; onSlotsChange?: (slots: FilmingSlot[]) => void }) {
  const nextKey = useRef(initialSlots.length || 1);
  const [slots, setSlots] = useState(() => (initialSlots.length ? initialSlots : [{ startsAt: '', endsAt: '', location: '' }]).map((slot, key) => ({ ...slot, key })));
  const bounds = filmingDateBounds();
  function commit(next: typeof slots) { setSlots(next); onSlotsChange?.(next.map(({ startsAt, endsAt, location }) => ({ startsAt, endsAt, location }))); }
  function update(key: number, field: keyof FilmingSlot, value: string) {
    commit(slots.map(slot => slot.key === key ? { ...slot, [field]: value } : slot));
  }
  return <div className="filming-slots">
    <p className="portal-field-help">Время московское (UTC+3). Для нескольких дней или площадок добавьте отдельные интервалы. Даты — до 6 месяцев вперёд. Заявку на съёмку необходимо подать не позднее чем за 14 дней до её начала.</p>
    {slots.map((slot, index) => <section className="filming-slot" key={slot.key} aria-label={`Интервал ${index + 1}`}>
      <div className="filming-slot-heading"><h3>Интервал {index + 1}</h3>{slots.length > 1 && <button type="button" className="filming-remove" aria-label={`Удалить интервал ${index + 1}`} onClick={() => commit(slots.filter(item => item.key !== slot.key))}>Удалить</button>}</div>
      <div className="portal-form-grid">
        <label><span>Начало <em>*</em></span><input name="slotStart" type="datetime-local" step={60} value={slot.startsAt} min={allowHistorical && initialSlots.some(item => item.startsAt === slot.startsAt) && slot.startsAt < bounds.min ? slot.startsAt : `${bounds.min}T00:00`} max={allowHistorical && initialSlots.some(item => item.startsAt === slot.startsAt) && slot.startsAt.slice(0, 10) > bounds.max ? slot.startsAt : `${bounds.max}T23:59`} onChange={e => update(slot.key, 'startsAt', e.target.value)} required /></label>
        <label><span>Окончание <em>*</em></span><input name="slotEnd" type="datetime-local" step={60} value={slot.endsAt} min={allowHistorical && initialSlots.some(item => item.endsAt === slot.endsAt) && slot.endsAt < bounds.min ? slot.endsAt : `${bounds.min}T00:00`} max={allowHistorical && initialSlots.some(item => item.endsAt === slot.endsAt) && slot.endsAt.slice(0, 10) > bounds.max ? slot.endsAt : `${bounds.max}T23:59`} onChange={e => update(slot.key, 'endsAt', e.target.value)} required /></label>
        <label className="wide"><span>Место проведения <em>*</em></span><input name="slotLocation" type="text" minLength={2} maxLength={240} value={slot.location} onChange={e => update(slot.key, 'location', e.target.value)} placeholder="Адрес, корпус и аудитория или название выездной площадки" required /><small>До 240 символов</small></label>
      </div>
    </section>)}
    <button className="filming-add" type="button" disabled={slots.length >= maxFilmingSlots} onClick={() => { const key = nextKey.current++; commit([...slots, { key, startsAt: '', endsAt: '', location: '' }]); }}>＋ Добавить дату или площадку</button>
    {slots.length >= maxFilmingSlots && <p className="portal-field-help">Можно добавить до {maxFilmingSlots} интервалов.</p>}
  </div>;
}
