// Usage: node scripts/play.mjs <url> <out-prefix> <script.js>  — runs a scripted session with screenshots
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, out, scriptFile] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
const steps = (await import('file://' + fs.realpathSync(scriptFile))).default;
let n = 0;
const shot = async (name) => { await page.screenshot({ path: `${out}_${name ?? n++}.png`, timeout: 120000 }); };
await steps(page, shot);
console.log(logs.slice(-40).join('\n'));
await browser.close();
