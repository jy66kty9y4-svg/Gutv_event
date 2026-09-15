export const applicationTextLimits = {
  eventTitle: [160, 'Название мероприятия'], eventDate: [10, 'Дата'],
  startTime: [5, 'Начало'], endTime: [5, 'Окончание'], location: [240, 'Место проведения'],
  eventDescription: [4000, 'Суть мероприятия'], requestedEquipment: [2000, 'Предполагаемое оборудование'],
  assignedEquipment: [2000, 'Согласованное оборудование'], contactName: [120, 'Контактное лицо'],
  contactChannel: [120, 'Телефон или Telegram'], customerComment: [2000, 'Комментарий'],
  internalComment: [3000, 'Внутренний комментарий'], closingReason: [500, 'Причина решения'],
} as const;

export function textLimitError(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return `Поле «${label}» должно содержать текст`;
  if (value.length > max) return `Поле «${label}»: не более ${max} символов`;
  return null;
}

export function applicationTextError(value: Record<string, unknown>) {
  for (const [key, [max, label]] of Object.entries(applicationTextLimits)) {
    const error = textLimitError(value[key], max, label);
    if (error) return error;
  }
  return null;
}
