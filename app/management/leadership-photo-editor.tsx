'use client';

import { useRef, useState } from 'react';
import type { PointerEvent, KeyboardEvent, Ref, ReactNode } from 'react';
import { photoCoordinates } from '../leadership-photo';
import type { LeadershipPhotoPosition } from '../leadership-types';
import styles from './leadership-photo-editor.module.css';
import LeadershipCard from '../leadership-card';

type Placement = { photoPosition: LeadershipPhotoPosition; photoScale: number };
type Props = Placement & { src: string; name: string; description: string; roles: string[]; roleIndices: number[]; renderPreview?: (imageRef: Ref<HTMLImageElement>) => ReactNode; disabled: boolean; onChange: (placement: Placement) => void };
const bound = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, value)) * 100) / 100;

export default function LeadershipPhotoEditor(props: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number; overflowX: number; overflowY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [roleIndex, setRoleIndex] = useState(0);
  const { x, y } = photoCoordinates(props.photoPosition);
  const role = props.roles[roleIndex] || props.roles[0] || 'Должность';
  function change(nextX: number, nextY: number, scale = props.photoScale) {
    props.onChange({ photoPosition: `${bound(nextX, 0, 100)}% ${bound(nextY, 0, 100)}%`, photoScale: bound(scale, .25, 3) });
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    const image = imageRef.current;
    if (props.disabled || event.button !== 0 || !image?.naturalWidth || !image.parentElement) return;
    const { width, height, left, right, top, bottom } = image.parentElement.getBoundingClientRect();
    // Captions are outside the crop; dragging starts only inside the photo viewport.
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) return;
    const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight) * props.photoScale;
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x, y,
      overflowX: image.naturalWidth * cover - width, overflowY: image.naturalHeight * cover - height };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || props.disabled) return;
    change(current.x - (Math.abs(current.overflowX) > .5 ? (event.clientX - current.startX) / current.overflowX * 100 : 0),
      current.y - (Math.abs(current.overflowY) > .5 ? (event.clientY - current.startY) / current.overflowY * 100 : 0));
  }
  function stop() { drag.current = null; setDragging(false); }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 5 : 1;
    if (props.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.parentElement) return;
    const { width, height } = image.parentElement.getBoundingClientRect();
    const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight) * props.photoScale;
    const sx = Math.sign(image.naturalWidth * cover - width);
    const sy = Math.sign(image.naturalHeight * cover - height);
    change(x + sx * (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), y + sy * (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0));
  }
  const controls = [
    { label: 'По горизонтали', value: x, min: 0, max: 100, step: 1, unit: '%', update: (v: number) => change(v, y) },
    { label: 'По вертикали', value: y, min: 0, max: 100, step: 1, unit: '%', update: (v: number) => change(x, v) },
    { label: 'Масштаб', value: Math.round(props.photoScale * 100), min: 25, max: 300, step: 1, unit: '%', update: (v: number) => change(x, y, v / 100) },
  ];
  return <section className={styles.editor} aria-label="Расположение фотографии">
    <div className={styles.heading}><strong>Предпросмотр карточки</strong><button type="button" disabled={props.disabled} onClick={() => change(50, 50, 1)}>Сбросить</button></div>
    {props.roles.length > 1 && <label>Предпросмотр должности<select value={roleIndex} disabled={props.disabled} onChange={(event) => setRoleIndex(Number(event.target.value))}>{props.roles.map((title, i) => <option key={i} value={i}>{title}</option>)}</select></label>}
    <div className={`${styles.preview} ${dragging ? styles.dragging : ''}`} tabIndex={props.disabled ? -1 : 0} role="group" aria-label="Переместить фотографию" aria-describedby="photo-drag-help" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={keys}>
      {/* eslint-disable-next-line react-hooks/refs -- The preview renderer forwards this ref to the image; it never reads current during render. */}
      {props.renderPreview ? props.renderPreview(imageRef) : <LeadershipCard person={{ name: props.name || 'Имя человека', description: props.description, photoUrl: props.src, photoPosition: props.photoPosition, photoScale: props.photoScale }} title={role} index={props.roleIndices[roleIndex] ?? 0} imageRef={imageRef} />}
    </div>
    <p className={styles.help} id="photo-drag-help">Перетащите фото мышью или пальцем. Текст остаётся на месте. Масштаб — от 25% до 300%; при уменьшении виден фон карточки. Можно использовать стрелки клавиатуры.</p>
    <div className={styles.controls}>{controls.map((control) => <div className={styles.control} key={control.label}>
      <label htmlFor={`photo-${control.label}`}>{control.label}</label>
      <input id={`photo-${control.label}`} aria-label={control.label} type="range" min={control.min} max={control.max} step={control.step} value={control.value} disabled={props.disabled} onChange={(event) => control.update(Number(event.target.value))} />
      <span><input aria-label={`${control.label}, значение`} type="number" min={control.min} max={control.max} step="0.01" value={control.value} disabled={props.disabled} onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) control.update(value); }} />{control.unit}</span>
    </div>)}</div>
  </section>;
}
