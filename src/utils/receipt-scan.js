/* ═══════════════════════════════════════════════════════════════
   FINOVA — receipt-scan.js
   Escáner de tickets: foto → OCR/IA → transacción real.

   NO monta ningún servicio nuevo. Usa lo que ya hay:
    · El proxy /api/ai de server.cjs, que pasa `content` tal cual y por
      tanto admite bloques de imagen. La clave vive en el servidor y
      nunca llega al frontend.
    · El almacén de fotos en IndexedDB (savePhoto/loadPhoto).
    · _txCreate() de transactions.js — la ÚNICA ruta de alta, la misma
      que usa el formulario normal.

   LÍMITE REAL: no todos los modelos ven imágenes. Claude Haiku, GPT-4o
   mini y Gemini Flash sí; el llama-3.3-70b que usa Groq NO. Si el
   servidor está configurado con Groq y el usuario no tiene clave
   propia, el escáner lo dice claramente en vez de fallar de forma rara.
   ═══════════════════════════════════════════════════════════════ */

/** Proveedores cuyo modelo fijado en server.cjs admite imágenes. */
const _RS_VISION_PROVIDERS = ['claude', 'openai', 'gemini'];

/* ── Preparación de la imagen ─────────────────────────────────────
   Dos tamaños distintos a propósito:
    · OCR: 1600 px. El adjunto que ya guardaba la app es de 640 px, y a
      esa resolución la letra pequeña de un ticket (importes, fecha) no
      es legible ni para una persona ni para el modelo.
    · Adjunto: el de 640 px de siempre, vía _resizeImageForStorage.    */
const _RS_OCR_MAX_PX = 1600;
const _RS_OCR_QUALITY = 0.82;

function _rsImageForOCR(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > _RS_OCR_MAX_PX || h > _RS_OCR_MAX_PX) {
          if (w > h) { h = Math.round(h * _RS_OCR_MAX_PX / w); w = _RS_OCR_MAX_PX; }
          else { w = Math.round(w * _RS_OCR_MAX_PX / h); h = _RS_OCR_MAX_PX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', _RS_OCR_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── Prompt ───────────────────────────────────────────────────────
   Se le pasan las categorías REALES de la app para que no se invente
   ninguna: Finova no tiene "Hogar" ni "Viajes" como categoría de gasto
   (IKEA cae en Vivienda y un hotel en Ocio), ni tiene subcategorías. */
function _rsBuildPrompt() {
  const cats = (APP.categories?.expense || []).filter(c => c !== UNCLASSIFIED_CATEGORY);
  return `Eres un extractor de datos de tickets y facturas españoles. Analiza la imagen y devuelve SOLO un objeto JSON, sin texto alrededor ni bloques de código.

Formato exacto:
{
  "merchant": string|null,
  "date": "YYYY-MM-DD"|null,
  "time": "HH:MM"|null,
  "total": number|null,
  "currency": "EUR"|"USD"|...|null,
  "receiptNumber": string|null,
  "paymentMethod": "efectivo"|"tarjeta"|"bizum"|"transferencia"|null,
  "taxId": string|null,
  "items": [{"name": string, "qty": number|null, "unitPrice": number|null, "total": number|null}],
  "taxBase": number|null,
  "taxAmount": number|null,
  "taxRate": number|null,
  "discount": number|null,
  "category": una de [${cats.join(', ')}] | null,
  "confidence": {"merchant": 0-1, "date": 0-1, "total": 0-1, "category": 0-1},
  "isReceipt": boolean
}

REGLAS INNEGOCIABLES:
- NO INVENTES NINGÚN DATO. Si un campo no se lee con claridad en la imagen, ponlo a null. Un null es una respuesta correcta; un dato inventado no.
- "total" es el importe final pagado, en números (1234.56), nunca texto.
- "date" es la fecha de COMPRA que aparece en el ticket. Si solo ves día y mes, usa el año actual (${new Date().getFullYear()}). Si no hay fecha, null.
- Para "category" elige SOLO de la lista dada. No inventes categorías nuevas ni uses subcategorías.
- Clasifica por los PRODUCTOS cuando se vean, no solo por el nombre del comercio: una compra en Amazon o El Corte Inglés puede ser de cualquier categoría según lo comprado.
- "confidence" refleja lo seguro que estás de CADA campo, de 0 a 1. Sé honesto: si la foto está borrosa, baja la confianza.
- "isReceipt" es false si la imagen no es un ticket, factura ni recibo.`;
}

/* ── Validación de la respuesta ───────────────────────────────────
   Nunca se guarda lo que diga el modelo sin comprobarlo. Un LLM puede
   devolver un número como texto, una fecha imposible o una categoría
   que no existe; todo eso se normaliza o se descarta aquí. */
function _rsValidate(raw) {
  let o = raw;
  if (typeof o === 'string') {
    // Algunos modelos envuelven el JSON en ```json … ``` pese a pedirlo limpio.
    const m = o.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, reason: 'La IA no devolvió datos en el formato esperado.' };
    try { o = JSON.parse(m[0]); }
    catch { return { ok: false, reason: 'La IA devolvió un JSON no válido.' }; }
  }
  if (!o || typeof o !== 'object') return { ok: false, reason: 'Respuesta vacía de la IA.' };

  if (o.isReceipt === false) {
    return { ok: false, reason: 'La imagen no parece un ticket, factura ni recibo.' };
  }

  const num = v => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const str = v => {
    const s = String(v ?? '').trim();
    return s && s.toLowerCase() !== 'null' ? s.slice(0, 120) : null;
  };
  // Fecha: solo se acepta YYYY-MM-DD real y no futura (un ticket no puede
  // ser de mañana; si el modelo lee mal el año, mejor pedirlo al usuario).
  const date = (() => {
    const s = str(o.date);
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    if (s > getTodayStr()) return null;
    return s;
  })();

  const total = (() => {
    const n = num(o.total);
    if (n === null || n <= 0) return null;
    return Math.round(Math.abs(n) * 100) / 100;
  })();

  const validCats = APP.categories?.expense || [];
  const category = validCats.includes(str(o.category)) ? str(o.category) : null;

  const items = Array.isArray(o.items)
    ? o.items.slice(0, 50).map(it => ({
        name: str(it?.name) || '(sin nombre)',
        qty: num(it?.qty),
        unitPrice: num(it?.unitPrice),
        total: num(it?.total),
      })).filter(it => it.name !== '(sin nombre)' || it.total !== null)
    : [];

  const conf = o.confidence && typeof o.confidence === 'object' ? o.confidence : {};
  const c01 = v => { const n = num(v); return n === null ? null : Math.min(1, Math.max(0, n)); };

  return {
    ok: true,
    data: {
      merchant: str(o.merchant),
      date,
      time: /^\d{1,2}:\d{2}$/.test(String(o.time ?? '')) ? String(o.time) : null,
      total,
      currency: str(o.currency) || 'EUR',
      receiptNumber: str(o.receiptNumber),
      paymentMethod: ['efectivo', 'tarjeta', 'bizum', 'transferencia'].includes(String(o.paymentMethod ?? '').toLowerCase())
        ? String(o.paymentMethod).toLowerCase() : null,
      taxId: str(o.taxId),
      items,
      taxBase: num(o.taxBase),
      taxAmount: num(o.taxAmount),
      taxRate: num(o.taxRate),
      discount: num(o.discount),
      category,
      confidence: {
        merchant: c01(conf.merchant), date: c01(conf.date),
        total: c01(conf.total), category: c01(conf.category),
      },
    },
  };
}

/* ── Duplicados ───────────────────────────────────────────────────
   No bloquea: avisa. Un gasto repetido legítimo (dos cafés el mismo día
   en el mismo sitio por el mismo importe) existe. */
function _rsFindDuplicate(d, imgHash) {
  if (!d.total || !d.date) return null;
  return (APP.transactions || []).find(t => {
    if (t.type !== 'expense') return false;
    if (imgHash && t.receipt?.imgHash && t.receipt.imgHash === imgHash) return true;
    if (d.receiptNumber && t.receipt?.receiptNumber === d.receiptNumber) return true;
    if (t.date !== d.date) return false;
    if (Math.abs(_num(t.amount) - d.total) > 0.01) return false;
    if (!d.merchant) return true;
    const a = _stripAccents(String(t.description || ''));
    const b = _stripAccents(d.merchant);
    return a.includes(b.slice(0, 8)) || b.includes(a.slice(0, 8));
  }) || null;
}

/** Hash rápido y estable de la imagen, para detectar la MISMA foto. */
function _rsHash(dataUrl) {
  let h = 0x811c9dc5;
  for (let i = 0; i < dataUrl.length; i += 7) {   // muestreo: basta y es rápido
    h ^= dataUrl.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + ':' + dataUrl.length;
}

/* ── Flujo ────────────────────────────────────────────────────────── */

let _rsState = null;   // { dataUrl, file, data, imgHash }

function openReceiptScanner() {
  if (typeof requireAccountFor === 'function' && !requireAccountFor('escanear tickets')) return;
  document.getElementById('receipt-scan-input')?.click();
}

async function handleReceiptFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  if (!/^image\//.test(file.type)) {
    return showToast('Por ahora solo se pueden escanear imágenes (JPG, PNG, HEIC). Para un PDF, haz una captura.', 'error');
  }
  if (file.size > 12 * 1024 * 1024) {
    return showToast('La imagen es demasiado grande (máx 12 MB).', 'error');
  }

  const provider = await _rsPickVisionProvider();
  if (!provider.ok) return showToast(provider.reason, 'error');

  let dataUrl;
  try { dataUrl = await _rsImageForOCR(file); }
  catch (e) { return showToast(e.message, 'error'); }

  _rsShowProgress(dataUrl);
  try {
    const text = await _rsCallVision(dataUrl, provider);
    const res = _rsValidate(text);
    if (!res.ok) { _rsCloseProgress(); return showToast(res.reason, 'error'); }
    _rsState = { dataUrl, file, data: res.data, imgHash: _rsHash(dataUrl) };
    _rsCloseProgress();
    _rsShowReview();
  } catch (err) {
    _rsCloseProgress();
    console.error('[Finova] Escaneo de ticket:', err);
    showToast(err.message || 'No se pudo analizar el ticket. Inténtalo de nuevo.', 'error');
  }
}

/**
 * Elige un proveedor con visión. El modelo de Groq (llama-3.3-70b) no ve
 * imágenes, así que si es el único disponible se dice con claridad en vez
 * de mandar la foto y recibir un error incomprensible.
 */
async function _rsPickVisionProvider() {
  // _serverAI/_serverProvider viven en ai.js, que es de carga diferida: si el
  // usuario nunca abrió el Asesor IA están sin definir y se concluiría, en
  // falso, que no hay clave de servidor. Se carga antes de decidir.
  if (typeof _serverAI === 'undefined' && typeof _lazyLoad === 'function' && _LAZY_SCRIPTS?.ai) {
    try {
      await _lazyLoad(_LAZY_SCRIPTS.ai);
      if (typeof initServerAI === 'function') await initServerAI();
    } catch { /* sin servidor: se sigue con las claves del usuario */ }
  }
  return _rsPickVisionProviderSync();
}

function _rsPickVisionProviderSync() {
  const keys = {
    claude: (APP.claudeApiKey || '').trim(),
    openai: (APP.openaiApiKey || '').trim(),
    gemini: (APP.geminiApiKey || '').trim(),
  };
  const preferred = APP.aiProvider;
  if (_RS_VISION_PROVIDERS.includes(preferred) && keys[preferred]) {
    return { ok: true, provider: preferred, apiKey: keys[preferred] };
  }
  for (const p of _RS_VISION_PROVIDERS) {
    if (keys[p]) return { ok: true, provider: p, apiKey: keys[p] };
  }
  // Sin clave propia: solo sirve la del servidor, y únicamente si NO es Groq.
  // _serverProvider lo rellena initServerAI() desde /api/ai-status (ai.js).
  if (typeof _serverAI !== 'undefined' && _serverAI === true &&
      typeof _serverProvider !== 'undefined' && _serverProvider !== 'groq') {
    return { ok: true, provider: 'claude', apiKey: '' };
  }
  return {
    ok: false,
    reason: 'El escaneo de tickets necesita un modelo que lea imágenes. Añade en Ajustes una clave de Claude, ChatGPT o Gemini (la de Groq no sirve: su modelo no procesa imágenes).',
  };
}

/** Llamada con bloque de imagen, en el formato de cada proveedor. */
async function _rsCallVision(dataUrl, provider) {
  const b64 = dataUrl.split(',')[1];
  const prompt = _rsBuildPrompt();

  // El proxy pasa `content` tal cual al proveedor, así que el bloque de
  // imagen viaja intacto y la clave del servidor nunca sale del backend.
  const content = provider.provider === 'openai'
    ? [{ type: 'text', text: prompt },
       { type: 'image_url', image_url: { url: dataUrl } }]
    : [{ type: 'text', text: prompt },
       { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }];

  const res = await api.ai({
    provider: provider.provider,
    apiKey: provider.apiKey,
    messages: [{ role: 'user', content }],
    anonMode: true,     // el contexto financiero no pinta nada aquí
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'El servicio de IA no respondió.');
  }
  const j = await res.json();
  return j.text || j.content || '';
}

/* ── UI: progreso ─────────────────────────────────────────────────── */

let _rsProgressTimer = null;

function _rsShowProgress(dataUrl) {
  const pasos = ['Analizando ticket…', 'Leyendo importes y fecha…', 'Identificando productos…', 'Clasificando el gasto…'];
  openModal('Escaneando ticket', `
    <div style="text-align:center">
      <img src="${dataUrl}" alt="Ticket" style="max-height:200px;max-width:100%;border-radius:var(--r-sm);object-fit:contain;opacity:.6" />
      <div style="margin-top:16px">
        <div class="rs-spinner" style="width:28px;height:28px;margin:0 auto;border:3px solid var(--border-default);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite"></div>
        <div id="rs-step" style="margin-top:12px;font-size:13.5px;color:var(--text-secondary)">${pasos[0]}</div>
      </div>
    </div>`, null);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';

  let i = 0;
  _rsProgressTimer = setInterval(() => {
    i = (i + 1) % pasos.length;
    const el = document.getElementById('rs-step');
    if (el) el.textContent = pasos[i];
  }, 1800);
}

function _rsCloseProgress() {
  if (_rsProgressTimer) { clearInterval(_rsProgressTimer); _rsProgressTimer = null; }
  closeModal();
}

/* ── UI: revisión y confirmación ──────────────────────────────────── */

function _rsConfBadge(v) {
  if (v === null || v === undefined) return '<span class="rs-conf rs-conf--low" title="Sin confianza declarada">?</span>';
  if (v >= 0.8) return '<span class="rs-conf rs-conf--high" title="Alta confianza">alta</span>';
  if (v >= 0.5) return '<span class="rs-conf rs-conf--mid" title="Confianza media — revísalo">media</span>';
  return '<span class="rs-conf rs-conf--low" title="Baja confianza — revísalo">baja</span>';
}

function _rsShowReview() {
  const d = _rsState.data;
  const dup = _rsFindDuplicate(d, _rsState.imgHash);
  const cats = APP.categories?.expense || [];

  const itemsHtml = d.items.length
    ? `<details class="settings-collapsible" style="margin-top:12px">
         <summary class="settings-collapsible-summary">
           <div class="settings-section-label" style="margin:0">Productos detectados (${d.items.length})</div>
           <svg class="icon icon-sm settings-collapsible-chevron" aria-hidden="true"><use href="#icon-chevron-right"/></svg>
         </summary>
         <table class="data-table" style="margin-top:10px">
           <thead><tr><th>Producto</th><th class="text-right">Uds</th><th class="text-right">Importe</th></tr></thead>
           <tbody>${d.items.map(it => `<tr>
             <td style="font-size:12px">${escapeHtml(it.name)}</td>
             <td class="text-right" style="font-size:12px">${it.qty ?? '—'}</td>
             <td class="text-right" style="font-size:12px">${it.total != null ? formatCurrency(it.total) : '—'}</td>
           </tr>`).join('')}</tbody>
         </table>
       </details>` : '';

  const taxHtml = (d.taxBase != null || d.taxAmount != null)
    ? `<div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);margin-top:10px">
         ${d.taxBase != null ? `<span>Base: <strong>${formatCurrency(d.taxBase)}</strong></span>` : ''}
         ${d.taxAmount != null ? `<span>IVA${d.taxRate ? ` (${d.taxRate}%)` : ''}: <strong>${formatCurrency(d.taxAmount)}</strong></span>` : ''}
       </div>` : '';

  const dupHtml = dup
    ? `<div class="fisc-alert fisc-alert-warning" style="margin-top:12px">
         <strong>Este ticket podría estar registrado ya:</strong>
         ${escapeHtml(dup.description)} · ${formatDate(dup.date)} · ${formatCurrency(_num(dup.amount))}.
         Puedes continuar igualmente si es un gasto distinto.
       </div>` : '';

  const missing = [];
  if (!d.total) missing.push('el importe');
  if (!d.date) missing.push('la fecha');
  if (!d.merchant) missing.push('el establecimiento');
  const missingHtml = missing.length
    ? `<div class="fisc-alert fisc-alert-info" style="margin-top:12px">
         No se pudo leer ${missing.join(' ni ')} con seguridad. Complétalo antes de guardar.
       </div>` : '';

  openModal('Revisar ticket', `
    <div style="display:grid;grid-template-columns:110px 1fr;gap:14px;align-items:start">
      <img src="${_rsState.dataUrl}" alt="Ticket"
           style="width:110px;border-radius:var(--r-sm);object-fit:cover;cursor:zoom-in"
           onclick="_rsViewFull()" title="Ver completo" />
      <div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label">Establecimiento ${_rsConfBadge(d.confidence.merchant)}</label>
          <input type="text" id="rs-merchant" class="text-input" value="${escapeHtml(d.merchant || '')}" placeholder="Nombre del comercio" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Importe (€) ${_rsConfBadge(d.confidence.total)}</label>
            <input type="number" id="rs-total" class="text-input" step="0.01" min="0" value="${d.total ?? ''}" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label class="form-label">Fecha ${_rsConfBadge(d.confidence.date)}</label>
            <input type="date" id="rs-date" class="text-input" value="${d.date || ''}" max="${getTodayStr()}" />
          </div>
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Categoría ${_rsConfBadge(d.confidence.category)}</label>
        <select id="rs-category" class="select-input">
          ${cats.map(c => `<option value="${escapeHtml(c)}"${c === (d.category || UNCLASSIFIED_CATEGORY) ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Método de pago</label>
        <select id="rs-payment" class="select-input">
          ${['', 'efectivo', 'tarjeta', 'bizum', 'transferencia'].map(p =>
            `<option value="${p}"${p === (d.paymentMethod || '') ? ' selected' : ''}>${p ? p[0].toUpperCase() + p.slice(1) : '(sin indicar)'}</option>`).join('')}
        </select>
      </div>
    </div>
    ${taxHtml}${itemsHtml}${missingHtml}${dupHtml}
  `, () => _rsConfirm());

  const btn = document.getElementById('modalConfirm');
  if (btn) btn.textContent = 'Confirmar y guardar';
}

function _rsViewFull() {
  if (!_rsState) return;
  const url = _rsState.dataUrl;
  openModal('Ticket', `<div style="text-align:center"><img src="${url}" alt="Ticket" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:var(--r-sm)" /></div>`, null);
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
}

/** Guarda usando _txCreate() — la misma ruta que el formulario normal. */
async function _rsConfirm() {
  if (!_rsState) return;
  const d = _rsState.data;

  const merchant = document.getElementById('rs-merchant')?.value.trim();
  const total = parseFloat(document.getElementById('rs-total')?.value);
  const date = document.getElementById('rs-date')?.value;
  const category = document.getElementById('rs-category')?.value;
  const payment = document.getElementById('rs-payment')?.value || null;

  if (!merchant) return showToast('Falta el establecimiento', 'error');
  if (!(total > 0)) return showToast('El importe debe ser mayor que 0', 'error');
  if (!date) return showToast('Falta la fecha', 'error');

  // El adjunto se guarda al tamaño de siempre (640 px), no el de OCR.
  let photoId = null;
  try {
    const small = await new Promise(resolve => _resizeImageForStorage(_rsState.file, resolve));
    photoId = generateId();
    await savePhoto(photoId, small);
  } catch {
    photoId = null;
    showToast('No se pudo guardar la foto; la transacción se guarda igualmente.', 'info');
  }

  _txCreate({
    type: 'expense', date, description: merchant, category, amount: total,
    note: payment ? `Pago: ${payment}` : '',
    photoId,
    receipt: {
      scannedAt: new Date().toISOString(),
      merchant, total, date,
      currency: d.currency, receiptNumber: d.receiptNumber, taxId: d.taxId,
      paymentMethod: payment, time: d.time,
      items: d.items, taxBase: d.taxBase, taxAmount: d.taxAmount, taxRate: d.taxRate,
      discount: d.discount, confidence: d.confidence,
      imgHash: _rsState.imgHash,
    },
  });

  if (typeof _patWrite === 'function') _patWrite(txPatternKey(merchant), category);
  APP.transactions.sort((a, b) => b.date.localeCompare(a.date));
  saveData();
  closeModal();
  renderTransactions();
  if (typeof renderDashboard === 'function') renderDashboard();
  _rsState = null;
  showToast(`Ticket guardado: ${merchant} · ${formatCurrency(total)} ✓`, 'success');
}
