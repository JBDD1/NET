/* Mide Core Web Vitals REALES con web-vitals (oficial) en Chrome vía Playwright.
   No es Lighthouse (no da el "score"), pero LCP/CLS/INP/FCP/TTFB salen de un
   navegador real renderizando la página servida. Uso:
     node scripts/measure-vitals.cjs <outDir>
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'lighthouse-before';
const BASE = 'http://localhost:4173';
const PAGES = ['/landing.html', '/index.html', '/faq.html'];
const WV = fs.readFileSync(path.resolve('node_modules/web-vitals/dist/web-vitals.attribution.iife.js'), 'utf8');

const SETUP = `
  window.__vitals = {};
  (function () {
    function save(m){ window.__vitals[m.name] = { value: m.value, rating: m.rating,
      target: (m.attribution && (m.attribution.element || m.attribution.largestShiftTarget || m.attribution.interactionTarget)) || null }; }
    webVitals.onLCP(save, {reportAllChanges:true});
    webVitals.onCLS(save, {reportAllChanges:true});
    webVitals.onINP(save, {reportAllChanges:true});
    webVitals.onFCP(save, {reportAllChanges:true});
    webVitals.onTTFB(save, {reportAllChanges:true});
  })();
`;

async function measure(browser, route, device) {
  const isMobile = device === 'mobile';
  const context = await browser.newContext({
    viewport: isMobile ? { width: 375, height: 667 } : { width: 1350, height: 940 },
    deviceScaleFactor: isMobile ? 2 : 1,
    isMobile,
    hasTouch: isMobile,
    userAgent: isMobile
      ? 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      : undefined,
  });
  const page = await context.newPage();
  // Un SOLO initScript: Playwright aísla cada uno en su scope, así que WV y su
  // uso tienen que compartir el mismo (webVitals es `var`, no global window).
  await page.addInitScript({ content: WV + '\n' + SETUP });

  const cdp = await context.newCDPSession(page);
  if (isMobile) {
    // Perfil tipo Lighthouse mobile: CPU 4x lenta, Slow 4G.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8, latency: 150,
    });
  }

  const t0 = Date.now();
  await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  // Interacción para INP: clics en elementos interactivos reales.
  try {
    const clickable = await page.$$('a, button, [data-action], summary, input');
    for (const el of clickable.slice(0, 4)) {
      await el.click({ timeout: 800, trial: false }).catch(() => {});
      await page.waitForTimeout(120);
    }
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(400);
    await page.mouse.wheel(0, -1200);
  } catch (_) {}
  await page.waitForTimeout(800);

  // Forzar el "final" de LCP/CLS ocultando la página (web-vitals reporta ahí).
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }) && document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);

  const vitals = await page.evaluate(() => window.__vitals);
  const loadMs = Date.now() - t0;
  await context.close();
  return { route, device, loadMs, vitals };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  for (const route of PAGES) {
    for (const device of ['mobile', 'desktop']) {
      const r = await measure(browser, route, device);
      results.push(r);
      const lcp = r.vitals.LCP ? Math.round(r.vitals.LCP.value) : '—';
      const cls = r.vitals.CLS ? r.vitals.CLS.value.toFixed(3) : '—';
      const inp = r.vitals.INP ? Math.round(r.vitals.INP.value) : '—';
      const fcp = r.vitals.FCP ? Math.round(r.vitals.FCP.value) : '—';
      console.log(`${device.padEnd(7)} ${route.padEnd(14)} LCP=${String(lcp).padStart(5)}ms  CLS=${cls}  INP=${inp}ms  FCP=${fcp}ms`);
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'web-vitals.json'), JSON.stringify(results, null, 2));
  console.log('\nGuardado en ' + path.join(OUT, 'web-vitals.json'));
})().catch(e => { console.error(e); process.exit(1); });
