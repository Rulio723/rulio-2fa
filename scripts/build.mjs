import { cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/css', { recursive: true });
await mkdir('dist/js/assets', { recursive: true });
await cp('public/index.html', 'dist/index.html');
await cp('public/css/app.css', 'dist/css/app.css');
await cp('public/js/assets/vue-3.4.20.global.prod.js', 'dist/js/assets/vue-3.4.20.global.prod.js');
await cp('public/favicon.ico', 'dist/favicon.ico');
await cp('LICENSE', 'dist/LICENSE.txt');
await build({ entryPoints: ['src/app.js'], outfile: 'dist/js/app.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2020'], legalComments: 'eof' });
await build({ entryPoints: ['src/qr-reader.js'], outfile: 'dist/js/qr-reader.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2020'], legalComments: 'eof' });
const licenses = await Promise.all(['otpauth/LICENSE.md', 'jssha/LICENSE', 'qrcode/license', 'dijkstrajs/LICENSE.md', 'lucide/LICENSE', 'jsqr/LICENSE'].map(async path => `\n\n${path}\n${await readFile('node_modules/' + path, 'utf8')}`));
await writeFile('dist/THIRD_PARTY.txt', await readFile('deploy/vue-license.txt', 'utf8') + licenses.join(''));
await cp('public/_headers', 'dist/_headers');
await cp('public/_redirects', 'dist/_redirects');
console.log('Static build ready in dist/');
