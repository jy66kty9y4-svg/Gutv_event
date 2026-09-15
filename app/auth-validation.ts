export const AUTH_LIMITS = {
  username: { min: 3, max: 60 },
  password: { min: 8, max: 200 },
  organizationName: { min: 2, max: 120 },
  representativeName: { min: 2, max: 120 },
  contact: { min: 3, max: 120 },
} as const;

export function normalizedUsername(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
}

function singleLine(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function registrationFields(body: Record<string, unknown>) {
  return {
    organizationType: body.organizationType === 'organization' || body.organizationType === 'faculty' ? body.organizationType : '',
    organizationName: singleLine(body.organizationName),
    representativeName: singleLine(body.representativeName),
    contact: singleLine(body.contact),
    username: typeof body.username === 'string' ? normalizedUsername(body.username) : '',
    // Passwords are exact, including their case and any spaces.
    password: typeof body.password === 'string' ? body.password : '',
  };
}

export function registrationValidationError(fields: ReturnType<typeof registrationFields>, raw: Record<string, unknown> = fields) {
  const labels = { organizationName: 'Название', representativeName: 'Контактное лицо', contact: 'Телефон или Telegram', username: 'Логин', password: 'Пароль' };
  for (const field of Object.keys(AUTH_LIMITS) as Array<keyof typeof AUTH_LIMITS>) {
    if (typeof raw[field] === 'string' && raw[field].length > AUTH_LIMITS[field].max) return `${labels[field]} — не более ${AUTH_LIMITS[field].max} символов`;
  }
  if (!fields.organizationType) return 'Выберите тип подразделения';
  if (fields.organizationName.length < AUTH_LIMITS.organizationName.min || fields.organizationName.length > AUTH_LIMITS.organizationName.max) return 'Название — от 2 до 120 символов';
  if (fields.representativeName.length < AUTH_LIMITS.representativeName.min || fields.representativeName.length > AUTH_LIMITS.representativeName.max) return 'Контактное лицо — от 2 до 120 символов';
  if (fields.contact.length < AUTH_LIMITS.contact.min || fields.contact.length > AUTH_LIMITS.contact.max) return 'Телефон или Telegram — от 3 до 120 символов';
  if (fields.username.length < AUTH_LIMITS.username.min || fields.username.length > AUTH_LIMITS.username.max) return 'Логин — от 3 до 60 символов';
  if (!/^[\p{L}\p{N}._-]+$/u.test(fields.username)) return 'В логине допустимы русские и латинские буквы, цифры, точка, дефис и подчёркивание. Пробелы не допускаются';
  if (fields.password.length < AUTH_LIMITS.password.min || fields.password.length > AUTH_LIMITS.password.max) return 'Пароль — от 8 до 200 символов. Русские буквы разрешены';
  return null;
}
