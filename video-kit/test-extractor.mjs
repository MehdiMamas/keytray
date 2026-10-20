// Proves lib/extract.ts finds the demo code. Run: node video-kit/test-extractor.mjs
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
const dir = new URL('.', import.meta.url);
const src = readFileSync(new URL('../lib/extract.ts', dir), 'utf8');
const js = (await transform(src, { loader: 'ts', format: 'esm' })).code;
const { extractCode } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const mail = readFileSync(new URL('demo-email.txt', dir), 'utf8');
const subject = /^Subject: (.*)$/m.exec(mail)[1];
const body = mail.split(/\n\n/).slice(1).join('\n\n');
const code = extractCode(subject, body);
console.log('extracted:', code);
if (code !== '482913') { console.error('FAIL'); process.exit(1); }
console.log('OK');
