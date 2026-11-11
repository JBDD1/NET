/* Comprueba problemas responsive REALES en Chrome vía Playwright:
   scroll horizontal, elementos que desbordan el viewport, y destinos táctiles
   < 44x44 px. Uso: node scripts/check-responsive.cjs */
const { chromium } = require('playwright');

const BASE = 'http://localhost:4173';
const PAGES = ['/landing.html', '/index.html', '/faq.html'];
const WIDTHS = [320, 375, 430];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const route of PAGES) {
    console.log('\n===== ' + route + ' =====');
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(600);
      const res = await page.evaluate((vw) => {
        const docW = document.documentElement.scrollWidth;
        const overflow = docW - document.documentElement.clientWidth;
        // Elementos que sobresalen por la derecha del viewport.
        const culprits = [];
        for (const el of document.body.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1.5) {
            const id = el.id ? '#' + el.id : '';
            const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
            culprits.push(el.tagName.toLowerCase() + id + cls + ' (right=' + Math.round(r.right) + ')');
          }
        }
        // Destinos táctiles pequeños (visibles, en el viewport inicial).
        const small = [];
        for (const el of document.querySelectorAll('a, button, [role=button], input, summary, [data-action]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || r.top > 800) continue;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (r.width < 44 || r.height < 44) {
            const id = el.id ? '#' + el.id : '';
            const txt = (el.textContent || '').trim().slice(0, 18);
            small.push(el.tagName.toLowerCase() + id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + txt + '"');
          }
        }
        return { docW, overflow, culprits: [...new Set(culprits)].slice(0, 8), smallCount: small.length, small: [...new Set(small)].slice(0, 6) };
      }, w);
      const hs = res.overflow > 1 ? `SCROLL-H +${res.overflow}px` : 'ok';
      console.log(`  ${w}px: ${hs} | tap<44: ${res.smallCount}`);
      if (res.culprits.length) console.log('    desbordan: ' + res.culprits.join(' · '));
      if (res.small.length) console.log('    tap pequeños: ' + res.small.join(' · '));
      await ctx.close();
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
