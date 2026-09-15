import sharp from 'sharp';
import { chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const mapping = {};
const images = [];

async function convert(directory) {
  for (const entry of await readdir(join(root, 'public', directory), { withFileTypes: true })) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) {
      await convert(relative);
    } else if (/\.(jpe?g|png)$/i.test(entry.name)) {
      const source = join(root, 'public', relative);
      const target = source.replace(/\.(jpe?g|png)$/i, '.webp');
      const input = await readFile(source);
      // Keep text, logos and transparency exact; use photographic compression elsewhere.
      const metadata = await sharp(input).metadata();
      const lossless = metadata.hasAlpha || /(?:logo|vk-reference|\/\d{4}\.png)/.test(relative);
      const output = await sharp(input, { failOn: 'error' }).autoOrient()
        .webp({ quality: 85, alphaQuality: 100, effort: 6, lossless }).toBuffer();
      await writeFile(target, output);
      await chmod(target, 0o644);
      mapping['/' + relative] = '/' + relative.replace(/\.(jpe?g|png)$/i, '.webp');
      images.push({ path: relative, before: input.length, after: output.length });
    }
  }
}

await convert('');
await writeFile(join(root, 'scripts/webp-assets.json'), JSON.stringify(mapping, null, 2) + '\n');
const before = images.reduce((total, item) => total + item.before, 0);
const after = images.reduce((total, item) => total + item.after, 0);
console.log(JSON.stringify({ count: images.length, before, after, savedPercent: Math.round((1 - after / before) * 100), images }, null, 2));
