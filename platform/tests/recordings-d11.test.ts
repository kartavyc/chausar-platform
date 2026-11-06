// Keep the nested per-place scenarios in the ordinary engine suite and its benchmark shards.
import { readdir } from 'node:fs/promises';

const folder = new URL('./recordings/', import.meta.url);
for (const file of (await readdir(folder)).filter(name => name.endsWith('.recording.test.ts')).sort()) {
  await import(new URL(file, folder).href);
}
