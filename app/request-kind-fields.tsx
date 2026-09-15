'use client';
import { useState } from 'react';
import { requestKinds, type RequestKind } from './filming-brief';

export type RequestKindValues = { requestKind: RequestKind; counts: Record<number, string>; deliveryDate: string };
export default function RequestKindFields({ specialties, initialValues, onValuesChange }: { specialties: Array<{ id: number; name: string }>; initialValues?: RequestKindValues; onValuesChange?: (value: RequestKindValues) => void }) {
  const [values, setValues] = useState<RequestKindValues>(() => ({ requestKind: initialValues?.requestKind || 'event', counts: initialValues?.counts || {}, deliveryDate: initialValues?.deliveryDate || '' }));
  const { requestKind: kind, counts } = values;
  function change(next: RequestKindValues) { setValues(next); onValuesChange?.(next); }
  return <>
    <div className="request-kind-grid">{Object.entries(requestKinds).map(([value, label]) => <label key={value}><input type="radio" name="requestKind" value={value} checked={kind === value} onChange={() => change({ ...values, requestKind: value as RequestKind })} required /><span>{label}</span></label>)}</div>
    {kind === 'trip' && <section className="trip-specialists" aria-labelledby="trip-specialists-title">
      <h3 id="trip-specialists-title">Специалисты для выездной учёбы</h3>
      <p className="portal-field-help">Выберите нужных специалистов и количество каждого — от 1 до 99. Окончательный состав определяет директор ГУТВ.</p>
      {specialties.length ? <div className="trip-specialist-grid">{specialties.map(item => {
        const selected = counts[item.id] !== undefined;
        return <div className={`trip-specialist-card${selected ? ' is-selected' : ''}`} key={item.id}>
          <label className="trip-specialist-choice"><input type="checkbox" name="specialtyId" value={item.id} checked={selected} onChange={e => { const next = { ...counts }; if (e.target.checked) next[item.id] = '1'; else delete next[item.id]; change({ ...values, counts: next }); }} /><span>{item.name}</span></label>
          {selected && <label className="trip-specialist-count"><span>Количество</span><input type="number" name={`specialtyCount-${item.id}`} min={1} max={99} step={1} value={counts[item.id]} onChange={e => change({ ...values, counts: { ...counts, [item.id]: e.target.value } })} required /></label>}
        </div>;
      })}</div> : <p role="status">Список специалистов пока пуст. Обратитесь к студии через раздел «Контакты».</p>}
    </section>}
  </>;
}
