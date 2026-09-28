// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [width] [height] [jsToEvalBeforeShot]
import { chromium } from 'playwright-core';
const [url, out, waitMs = '3000', w = '1440', h = '900', js] = process.argv.slice(2);
const exe = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+waitMs);
if (js) { await page.evaluate(js); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
console.log(logs.slice(-40).join('\n'));
await browser.close();
