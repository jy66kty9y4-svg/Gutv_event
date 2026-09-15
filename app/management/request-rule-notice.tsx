'use client';
import { useEffect, useRef, useState } from 'react';
import { readFilmingSlots, type FilmingBrief } from '../filming-brief';
import { requestDeadlineWarnings } from '../request-deadlines';

export default function RequestRuleNotice({ brief, submittedAt, initialStatus }: { brief: FilmingBrief | null; submittedAt: string; initialStatus: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(() => ({ warnings: requestDeadlineWarnings(brief, submittedAt), status: initialStatus }));
  useEffect(() => {
    const form = root.current?.closest('form');
    if (!form) return;
    function update() {
      const data = new FormData(form!);
      const next = brief ? { ...brief, requestKind: String(data.get('requestKind')) as FilmingBrief['requestKind'], slots: readFilmingSlots(data) } : null;
      setState({ warnings: requestDeadlineWarnings(next, submittedAt), status: String(data.get('status')) });
    }
    form.addEventListener('input', update); form.addEventListener('change', update);
    return () => { form.removeEventListener('input', update); form.removeEventListener('change', update); };
  }, [brief, submittedAt]);
  return <div ref={root} className="request-rule-notice">
    {state.warnings.length > 0 && <section className="portal-alert warning" aria-label="Несоответствие срокам подачи">
      <strong>Проверка сроков подачи заявки</strong>
      <ul>{state.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      {state.status === 'approved' && <label className="rule-exception-consent" key={state.warnings.join('|')}><input type="checkbox" name="acceptRuleException" value="true" required /><span>Согласовать несмотря на несоответствие правилам. Я проверил сроки подачи заявки.</span></label>}
    </section>}
  </div>;
}
