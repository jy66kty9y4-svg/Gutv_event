export const participantsHint = 'Положительное целое число или диапазон: 5, 5 человек, 5–10 человек.';

export function participantsError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return 'Количество участников: до 80 символов. ' + participantsHint;
  const match = /^([1-9]\d*)(?:\s*[-–—]\s*([1-9]\d*))?(?:\s+(?:человек|человека|чел\.?))?$/iu.exec(value.trim());
  if (!match) return 'Укажите количество участников. ' + participantsHint;
  if (match[2] && BigInt(match[2]) < BigInt(match[1])) return 'В диапазоне количество «до» должно быть не меньше количества «от».';
  return null;
}
