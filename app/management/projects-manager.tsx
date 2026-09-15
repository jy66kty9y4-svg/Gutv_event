'use client';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ProjectDraft, StudioProject } from '../project-types';
import ProjectCard from '../project-card';
import LeadershipPhotoEditor from './leadership-photo-editor';
import styles from './leadership-manager.module.css';
import layout from './projects-manager.module.css';
const empty: ProjectDraft = { title: '', eyebrow: '', description: '', url: '', linkLabel: 'Открыть проект', photoUrl: '', photoPosition: 'center center', photoScale: 1, tone: 'blue' };
export default function ProjectsManager() {
  const [projects, setProjects] = useState<StudioProject[]>([]), [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null | undefined>(undefined), [draft, setDraft] = useState<ProjectDraft>(empty);
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const drawer = useRef<HTMLElement>(null), fileInput = useRef<HTMLInputElement>(null), saving = useRef(false);
  const open = editing !== undefined;
  async function api(path = '', method = 'GET', body?: unknown) {
    const response = await fetch(`/api/admin/projects${path}`, { method, cache: 'no-store', ...(body !== undefined ? { headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось сохранить изменения');
    return data;
  }
  useEffect(() => { let active = true; api().then(data => { if (active) setProjects(data.projects); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  // Preview URLs are created by the file-selection event; the effect only releases them.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function selectFile(next: File | null) {
    setFile(next); setPreview(next ? URL.createObjectURL(next) : '');
  }
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow, trigger = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden'; drawer.current?.querySelector<HTMLInputElement>('input:not([type=file])')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving.current) setEditing(undefined);
      if (event.key !== 'Tab') return;
      const items = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=file]),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', keys); trigger?.focus(); };
  }, [open]);
  function edit(project?: StudioProject) {
    setEditing(project?.id ?? null); setDraft(project ? Object.fromEntries(Object.keys(empty).map(k => [k, project[k as keyof ProjectDraft]])) as ProjectDraft : { ...empty });
    selectFile(null); setError(''); setNotice(''); setConfirmDelete(false);
  }
  async function mutate(action: () => Promise<void>) {
    if (saving.current) return; saving.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить изменения'); }
    finally { saving.current = false; setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault(); void mutate(async () => {
      let photoUrl = draft.photoUrl;
      if (file) { const form = new FormData(); form.set('file', file); photoUrl = (await api('/photos', 'POST', form)).photoUrl; setDraft(v => ({ ...v, photoUrl })); selectFile(null); }
      const result = await api(editing ? `/${editing}` : '', editing ? 'PATCH' : 'POST', { ...draft, photoUrl });
      setProjects(result.projects); setEditing(undefined); setNotice('Карточка сохранена на сайте');
    });
  }
  function move(index: number, direction: number) { void mutate(async () => { const ids = projects.map(p => p.id); [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]; setProjects((await api('/order', 'PUT', { ids })).projects); }); }
  function remove() { void mutate(async () => { setProjects((await api(`/${editing}`, 'DELETE')).projects); setEditing(undefined); setNotice('Карточка удалена'); }); }
  const visibleDraft = { ...draft, photoUrl: preview || draft.photoUrl };
  return <section className={styles.manager}>
    <div className={styles.header}><p>Добавляйте проекты и меняйте их порядок. Предпросмотр повторяет карточку на сайте.</p><button className={styles.primary} disabled={busy || loading} onClick={() => edit()}>+ Добавить проект</button></div>
    {error && !open && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    {loading ? <p className={styles.loading}>Загрузка…</p> : <div className={layout.list}>{projects.map((project, index) => <div className={layout.row} key={project.id}>
      <div className={layout.thumb}><ProjectCard project={project} preview compact /></div><div className={layout.summary}><strong>{project.title}</strong><small>{project.eyebrow || 'Проект'} · {index + 1} в карусели</small></div>
      <div className={styles.rowActions}><button disabled={busy || index === 0} aria-label={`Выше: ${project.title}`} onClick={() => move(index, -1)}>↑</button><button disabled={busy || index === projects.length - 1} aria-label={`Ниже: ${project.title}`} onClick={() => move(index, 1)}>↓</button><button disabled={busy} onClick={() => edit(project)}>Изменить</button></div>
    </div>)}{!projects.length && <p className={styles.empty}>Проектов пока нет. Добавьте первую карточку.</p>}</div>}
    {open && <div className={styles.backdrop}><aside className={styles.drawer} ref={drawer} role="dialog" aria-modal="true" aria-labelledby="project-editor-title">
      <header><div><span>НАШИ ПРОЕКТЫ</span><h2 id="project-editor-title">{editing ? 'Редактировать проект' : 'Новый проект'}</h2></div><button type="button" aria-label="Закрыть редактор" disabled={busy} onClick={() => setEditing(undefined)}>×</button></header>
      <form onSubmit={save}><main>{error && <p role="alert" className={styles.error}>{error}</p>}
        <label><span>Название</span><input required minLength={2} maxLength={120} value={draft.title} disabled={busy} onChange={e => setDraft(v => ({ ...v, title: e.target.value }))} /></label>
        <label><span>Надпись над названием</span><input maxLength={80} value={draft.eyebrow} disabled={busy} onChange={e => setDraft(v => ({ ...v, eyebrow: e.target.value }))} /></label>
        <label><span>Описание</span><textarea rows={3} maxLength={600} value={draft.description} disabled={busy} onChange={e => setDraft(v => ({ ...v, description: e.target.value }))} /></label>
        <label><span>Ссылка</span><input type="url" placeholder="https://" maxLength={2048} value={draft.url} disabled={busy} onChange={e => setDraft(v => ({ ...v, url: e.target.value }))} /></label>
        <label><span>Текст ссылки</span><input maxLength={60} value={draft.linkLabel} disabled={busy} onChange={e => setDraft(v => ({ ...v, linkLabel: e.target.value }))} /></label>
        <label><span>Фон карточки</span><select value={draft.tone} disabled={busy} onChange={e => setDraft(v => ({ ...v, tone: e.target.value as ProjectDraft['tone'] }))}><option value="dark">Тёмный</option><option value="blue">Синий</option><option value="light">Светлый</option></select></label>
        <div className={styles.photoEditor}><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{visibleDraft.photoUrl ? 'Заменить фото' : 'Добавить фото'}</button>{visibleDraft.photoUrl && <button type="button" disabled={busy} onClick={() => { selectFile(null); setDraft(v => ({ ...v, photoUrl: '' })); }}>Убрать фото</button>}<input ref={fileInput} tabIndex={-1} type="file" className={styles.hiddenFile} accept="image/jpeg,image/png,image/webp" onChange={e => { const next = e.target.files?.[0]; e.target.value = ''; if (!next) return; if (!['image/jpeg','image/png','image/webp'].includes(next.type) || next.size > 5 * 1024 * 1024) { setError('Выберите JPEG, PNG или WebP до 5 МБ'); return; } setError(''); selectFile(next); setDraft(v => ({ ...v, photoPosition: 'center center', photoScale: 1 })); }} /></div>
        {visibleDraft.photoUrl ? <LeadershipPhotoEditor src={visibleDraft.photoUrl} name={draft.title} description={draft.description} roles={[]} roleIndices={[]} photoPosition={draft.photoPosition} photoScale={draft.photoScale} disabled={busy} onChange={placement => setDraft(v => ({ ...v, ...placement }))} renderPreview={imageRef => <ProjectCard project={visibleDraft} preview imageRef={imageRef} />} /> : <div><p>Предпросмотр карточки</p><ProjectCard project={visibleDraft} preview /></div>}
      </main><footer>{confirmDelete ? <><p className={styles.confirmText}>Удалить проект с сайта?</p><div className={styles.confirmActions}><button type="button" disabled={busy} onClick={remove}>Да, удалить</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Отмена</button></div></> : <><button className={styles.primary} disabled={busy || draft.title.trim().length < 2} type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</button>{editing && <button className={styles.destructive} type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Удалить проект</button>}</>}</footer></form>
    </aside></div>}
  </section>;
}
