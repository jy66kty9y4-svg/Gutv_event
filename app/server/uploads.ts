import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const allowedTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);
const allowedExtensions = new Map([
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
]);

export const maxAttachmentSize = 10 * 1024 * 1024;
export const maxAttachmentCount = 5;

function uploadRoot() {
  if (process.env.GUTV_UPLOAD_PATH) return process.env.GUTV_UPLOAD_PATH;
  const databasePath = process.env.GUTV_DATABASE_PATH;
  if (!databasePath) throw new Error('GUTV_DATABASE_PATH is not configured');
  return join(dirname(databasePath), 'uploads');
}

export function validateAttachments(files: File[]) {
  if (files.length > maxAttachmentCount) return `Можно прикрепить не более ${maxAttachmentCount} файлов`;
  for (const file of files) {
    const extension = extname(file.name).toLocaleLowerCase('en-US');
    if (!file.size) return 'Пустой файл нельзя прикрепить';
    if (file.size > maxAttachmentSize) return `Файл «${file.name}» больше 10 МБ`;
    if (!allowedExtensions.has(extension) || (file.type && file.type !== 'application/octet-stream' && !allowedTypes.has(file.type))) {
      return `Формат файла «${file.name}» не поддерживается`;
    }
  }
  return null;
}

export function attachmentMimeType(file: File) {
  return allowedExtensions.get(extname(file.name).toLocaleLowerCase('en-US')) || 'application/octet-stream';
}

export async function saveAttachment(file: File) {
  const root = uploadRoot();
  await mkdir(root, { recursive: true });
  const extension = extname(file.name).toLocaleLowerCase('en-US').replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const storedName = `${randomUUID()}${extension}`;
  await writeFile(join(root, storedName), Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
  return storedName;
}

export function loadAttachment(storedName: string) {
  if (!/^[a-f0-9-]{36}(\.[a-z0-9]{1,9})?$/.test(storedName)) throw new Error('Invalid stored filename');
  return readFile(join(uploadRoot(), storedName));
}

export async function removeAttachment(storedName: string) {
  try { await unlink(join(uploadRoot(), storedName)); } catch { /* rollback cleanup is best effort */ }
}
