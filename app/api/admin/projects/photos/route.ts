import { uploadManagementPhoto } from '@/app/server/management-photo';
export const runtime = 'nodejs';
export async function POST(request: Request) { return uploadManagementPhoto(request, 'projects.manage'); }
