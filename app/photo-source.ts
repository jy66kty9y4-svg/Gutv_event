import webpAssets from '@/scripts/webp-assets.json';

export function webpPhotoUrl(url: string) {
  return webpAssets[url as keyof typeof webpAssets] || url;
}

export function photoSource(url: string) {
  const source = webpPhotoUrl(url);
  // Existing photo IDs keep their URLs; bypass any cached pre-migration JPEG/PNG.
  return /^\/api\/leadership\/photos\/\d+$/.test(source) ? `${source}?format=webp` : source;
}
