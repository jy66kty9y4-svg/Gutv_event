'use client';
import { participantsError, participantsHint } from './participants-validation';

export default function ParticipantsField({ defaultValue = '' }: { defaultValue?: string }) {
  return <label className="wide"><span>Количество участников <em>*</em></span><input name="participants" type="text" maxLength={80} defaultValue={defaultValue} placeholder="Например, 5–10 человек" aria-describedby="participants-hint" ref={input => { if (input) input.setCustomValidity(participantsError(input.value) || ''); }} onInput={event => event.currentTarget.setCustomValidity(participantsError(event.currentTarget.value) || '')} required /><small id="participants-hint">{participantsHint}</small></label>;
}
