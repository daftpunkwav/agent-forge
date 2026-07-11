import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(m.text());
});
page.on('requestfailed', (r) => {
  logs.push(`fail ${r.url()} ${r.failure()?.errorText || ''}`);
});

try {
  await page.goto('http://localhost:5280/', { waitUntil: 'networkidle', timeout: 20000 });
} catch (e) {
  errors.push(`goto ${e.message}`);
}
await page.waitForTimeout(2000);

let root = '';
try {
  root = await page.$eval('#root', (el) => el.innerHTML.slice(0, 300));
} catch (e) {
  root = `no-root: ${e.message}`;
}

console.log('ROOT:', root);
console.log('ERRORS:', JSON.stringify(errors, null, 2));
console.log('LOGS:', JSON.stringify(logs, null, 2));
await browser.close();
