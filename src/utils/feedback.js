'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — FEEDBACK EN LA APP

   Modal para reportar fallos, pedir funciones o preguntar. Se carga en
   diferido (_LAZY_SCRIPTS.feedback) porque la mayoría de sesiones no lo abren.

   La regla que gobierna este fichero: **nunca se envían datos financieros**.
   Ni importes, ni transacciones, ni cartera, ni saldos, ni con la casilla
   técnica marcada. Lo que se manda está en _fvBuildTech() y se puede leer de
   un tirón; hay un test que falla si alguien mete ahí una clave de APP.
═══════════════════════════════════════════════════════════════ */

const _FB_TYPES = [
  { v: 'bug',      label: 'Algo no funciona' },
  { v: 'idea',     label: 'Tengo una idea' },
  { v: 'question', label: 'Pregunta' },
  { v: 'other',    label: 'Otro' },
];

const _FB_MIN = 10;
const _FB_MAX = 2000;
// Tiempo mínimo entre abrir el modal y enviar. Un humano no escribe 10
// caracteres útiles en menos de 3 segundos; un bot sí.
const _FB_MIN_OPEN_MS = 3000;

let _fbOpenedAt = 0;
let _fbSending  = false;
// Se conserva fuera del DOM para que, si el envío falla y el usuario cierra
// el modal sin querer, al reabrirlo siga ahí lo que había escrito.
let _fbDraft = null;

/* ─── Informe técnico ─────────────────────────────────────────── */

/**
 * Lo ÚNICO que se envía como información técnica.
 *
 * Deliberadamente no toca APP en ningún punto salvo APP.activeSection (el
 * nombre de la sección, p.ej. "transactions") y APP.variant/APP.theme (el
 * tema visual). Nada de esto es un dato financiero.
 */
async function _fvBuildTech() {
  const nav = navigator || {};
  const tech = {
    version:  typeof FINOVA_VERSION !== 'undefined' ? FINOVA_VERSION : '?',
    section:  (typeof APP !== 'undefined' && APP.activeSection) || '?',
    theme:    (typeof APP !== 'undefined' ? `${APP.variant || '?'} / ${APP.theme || '?'}` : '?'),
    // userAgent completo pero truncado: es lo que de verdad identifica el
    // navegador y el sistema, y reconstruirlo a mano acaba mintiendo.
    ua:       String(nav.userAgent || '').slice(0, 300),
    lang:     String(nav.language || ''),
    screen:   `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr:      window.devicePixelRatio || 1,
    online:   !!nav.onLine,
    demo:     typeof _isDemoMode !== 'undefined' ? !!_isDemoMode : false,
    errors:   typeof fvRecentErrors === 'function' ? fvRecentErrors() : [],
  };

  // El nombre de la caché del service worker dice qué build tiene cargado el
  // navegador de verdad, que no siempre es el último desplegado.
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      const shell = keys.find(k => /^finova-v\d+/.test(k));
      if (shell) tech.build = shell;
    }
  } catch (_) { /* sin Cache API: no es información crítica */ }

  return tech;
}

/* ─── Validación ──────────────────────────────────────────────── */

function _fbShowFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent   = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function _fbClearErrors() {
  ['fb-err-message', 'fb-err-email', 'fb-err-form'].forEach(id => _fbShowFieldError(id, ''));
}

/* ─── Modal ───────────────────────────────────────────────────── */

function openFeedbackModal(presetType) {
  _fbOpenedAt = Date.now();
  _fbSending  = false;

  const email = (typeof APP !== 'undefined' && APP.userEmail) || '';
  const d     = _fbDraft || {};
  const esc   = v => (typeof escapeHtml === 'function' ? escapeHtml(String(v ?? '')) : String(v ?? ''));

  const typeOpts = _FB_TYPES.map(t =>
    `<option value="${t.v}"${(d.type || presetType || 'bug') === t.v ? ' selected' : ''}>${esc(t.label)}</option>`
  ).join('');

  openModal('Enviar feedback', `
    <div class="fb-faq-hint">
      <svg class="icon icon-xs" aria-hidden="true"><use href="#icon-info"></use></svg>
      <span>¿Has mirado la FAQ? Quizá ya esté respondido.</span>
      <button type="button" class="fb-link-btn" onclick="closeModal(); openFaqModal();">Ver la FAQ</button>
    </div>

    <div class="form-group">
      <label class="form-label" for="fb-type">¿De qué se trata?</label>
      <select id="fb-type" class="select-input" onchange="_fbOnTypeChange()">${typeOpts}</select>
    </div>

    <div class="form-group">
      <label class="form-label" for="fb-message">
        Cuéntanos <span style="color:var(--down)">*</span>
      </label>
      <textarea id="fb-message" class="text-input" rows="5"
        maxlength="${_FB_MAX}" aria-describedby="fb-count fb-err-message"
        placeholder="Qué esperabas que pasara y qué pasó en su lugar. Cuanto más concreto, mejor."
        oninput="_fbOnMessageInput()">${esc(d.message || '')}</textarea>
      <div class="fb-count-row">
        <div id="fb-err-message" class="fb-field-error" role="alert" aria-live="assertive" style="display:none"></div>
        <div id="fb-count" class="fb-count" aria-live="off">0 / ${_FB_MAX}</div>
      </div>
    </div>

    <div class="form-group" id="fb-rating-group" style="display:none">
      <label class="form-label" for="fb-rating-1">¿Cómo te va con Finova? <span class="fb-optional">(opcional)</span></label>
      <div class="fb-rating" role="group" aria-label="Valoración de 1 a 5, opcional">
        ${[1, 2, 3, 4, 5].map(n => `
          <button type="button" class="fb-star" id="fb-rating-${n}" data-val="${n}"
            aria-pressed="false" aria-label="${n} de 5"
            onclick="_fbSetRating(${n})">${n}</button>`).join('')}
        <button type="button" class="fb-link-btn" id="fb-rating-clear"
          onclick="_fbSetRating(0)" style="display:none">Quitar</button>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="fb-email">
        Tu correo <span class="fb-optional">(opcional)</span>
      </label>
      <input type="email" id="fb-email" class="text-input" autocomplete="email"
        placeholder="tu@correo.com" aria-describedby="fb-email-hint fb-err-email"
        value="${esc(d.email != null ? d.email : email)}" />
      <div id="fb-email-hint" class="fb-hint">Solo lo usaremos para responderte. Si lo dejas vacío, no podremos contestarte.</div>
      <div id="fb-err-email" class="fb-field-error" role="alert" aria-live="assertive" style="display:none"></div>
    </div>

    <div class="form-group">
      <label class="fb-check">
        <input type="checkbox" id="fb-tech" ${d.tech === false ? '' : 'checked'} onchange="_fbToggleTechDetail()" />
        <span>Incluir información técnica</span>
      </label>
      <div class="fb-hint">
        Nos ayuda a reproducir el problema.
        <button type="button" class="fb-link-btn" onclick="_fbToggleTechPeek()" aria-expanded="false" id="fb-tech-peek-btn">Ver qué se envía</button>
      </div>
      <pre id="fb-tech-peek" class="fb-tech-peek" style="display:none" aria-live="polite"></pre>
    </div>

    <!-- Honeypot: invisible para personas, irresistible para bots que
         rellenan todos los campos de un formulario. Si llega con algo, el
         servidor descarta el envío. No usa display:none porque algunos bots
         lo detectan; se saca de la vista con posicionamiento. -->
    <div class="fb-honeypot" aria-hidden="true">
      <label for="fb-website">No rellenar</label>
      <input type="text" id="fb-website" name="website" tabindex="-1" autocomplete="off" />
    </div>

    <p class="fb-privacy">
      Enviamos tu mensaje, el correo que pongas y, si lo dejas marcado, la
      información técnica de arriba. <strong>Nunca</strong> enviamos tus
      transacciones, tu cartera ni tus saldos.
      Lo usamos solo para responderte y arreglar lo que nos cuentes.
      <a href="privacidad.html#s8" target="_blank" rel="noopener">Política de privacidad</a>
    </p>

    <div id="fb-err-form" class="fb-field-error" role="alert" aria-live="assertive" style="display:none;margin-bottom:10px"></div>
    <div id="fb-ok" class="fb-ok" role="status" aria-live="polite" style="display:none"></div>

    <div class="modal-footer-btns">
      <div class="modal-footer-btns-right" style="margin-left:auto">
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="button" class="btn-primary" id="fb-send-btn" onclick="_fbSubmit()">Enviar</button>
      </div>
    </div>`, null);

  // El modal trae sus propios botones.
  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';

  _fbOnTypeChange();
  _fbOnMessageInput();
  if (d.rating) _fbSetRating(d.rating);

  // El foco va al textarea, que es lo que el usuario viene a rellenar.
  setTimeout(() => document.getElementById('fb-message')?.focus(), 80);
}

function _fbOnTypeChange() {
  const t = document.getElementById('fb-type')?.value;
  // La valoración solo se pregunta en "Otro": en un reporte de fallo, pedir
  // una nota de 1 a 5 justo cuando algo acaba de romperse es de mal gusto.
  const g = document.getElementById('fb-rating-group');
  if (g) g.style.display = t === 'other' ? '' : 'none';
}

function _fbOnMessageInput() {
  const ta = document.getElementById('fb-message');
  const c  = document.getElementById('fb-count');
  if (!ta || !c) return;
  const n = ta.value.length;
  c.textContent = `${n} / ${_FB_MAX}`;
  c.classList.toggle('is-low',  n > 0 && n < _FB_MIN);
  c.classList.toggle('is-near', n > _FB_MAX - 100);
  if (n >= _FB_MIN) _fbShowFieldError('fb-err-message', '');
}

let _fbRating = 0;
function _fbSetRating(n) {
  _fbRating = Number(n) || 0;
  for (let i = 1; i <= 5; i++) {
    const b = document.getElementById('fb-rating-' + i);
    if (!b) continue;
    const on = i <= _fbRating;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  const clear = document.getElementById('fb-rating-clear');
  if (clear) clear.style.display = _fbRating ? '' : 'none';
}

function _fbToggleTechDetail() {
  // Si se desmarca, se cierra también la vista previa para que no quede
  // enseñando algo que ya no se va a enviar.
  const on = document.getElementById('fb-tech')?.checked;
  if (!on) {
    const peek = document.getElementById('fb-tech-peek');
    const btn  = document.getElementById('fb-tech-peek-btn');
    if (peek) peek.style.display = 'none';
    if (btn)  btn.setAttribute('aria-expanded', 'false');
  }
}

async function _fbToggleTechPeek() {
  const peek = document.getElementById('fb-tech-peek');
  const btn  = document.getElementById('fb-tech-peek-btn');
  if (!peek) return;
  const open = peek.style.display !== 'none';
  if (open) {
    peek.style.display = 'none';
    btn?.setAttribute('aria-expanded', 'false');
    return;
  }
  // Se muestra lo que de verdad se va a enviar, no una descripción de ello:
  // es la única forma de que el usuario pueda decidir con información.
  peek.textContent = JSON.stringify(await _fvBuildTech(), null, 2);
  peek.style.display = 'block';
  btn?.setAttribute('aria-expanded', 'true');
}

/* ─── Envío ───────────────────────────────────────────────────── */

function _fbSnapshotDraft() {
  _fbDraft = {
    type:    document.getElementById('fb-type')?.value || 'bug',
    message: document.getElementById('fb-message')?.value || '',
    email:   document.getElementById('fb-email')?.value || '',
    tech:    !!document.getElementById('fb-tech')?.checked,
    rating:  _fbRating,
  };
  return _fbDraft;
}

function _fbSetSending(on) {
  _fbSending = on;
  const btn = document.getElementById('fb-send-btn');
  if (btn) {
    btn.disabled    = on;
    btn.textContent = on ? 'Enviando…' : 'Enviar';
    btn.style.opacity = on ? '.6' : '1';
  }
}

async function _fbSubmit() {
  // Sin esto, un doble clic manda dos veces: el servidor los cuenta como dos
  // envíos distintos y se gasta el límite por nada.
  if (_fbSending) return;
  _fbClearErrors();

  const d = _fbSnapshotDraft();
  const msg = d.message.trim();

  if (msg.length < _FB_MIN) {
    _fbShowFieldError('fb-err-message', `Cuéntanos un poco más: al menos ${_FB_MIN} caracteres.`);
    document.getElementById('fb-message')?.focus();
    return;
  }
  if (msg.length > _FB_MAX) {
    _fbShowFieldError('fb-err-message', `El mensaje es demasiado largo (máximo ${_FB_MAX} caracteres).`);
    return;
  }
  const emailTrim = d.email.trim();
  if (emailTrim && !(typeof fvIsValidEmail === 'function' ? fvIsValidEmail(emailTrim) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailTrim))) {
    _fbShowFieldError('fb-err-email', 'Ese correo no parece válido. Déjalo vacío si prefieres no responderte.');
    document.getElementById('fb-email')?.focus();
    return;
  }

  const payload = {
    type:    d.type,
    message: msg,
    email:   emailTrim || null,
    rating:  d.type === 'other' && _fbRating ? _fbRating : null,
    tech:    d.tech ? await _fvBuildTech() : null,
    // Antispam: el honeypot y cuánto tiempo ha estado abierto el formulario.
    hp:      document.getElementById('fb-website')?.value || '',
    openMs:  Date.now() - _fbOpenedAt,
  };

  if (payload.openMs < _FB_MIN_OPEN_MS) {
    _fbShowFieldError('fb-err-form', 'Un momento… revisa el mensaje y vuelve a pulsar Enviar.');
    return;
  }

  _fbSetSending(true);
  let res, json = {};
  try {
    res = await api.feedback(payload);
    try { json = await res.json(); } catch (_) { json = {}; }
  } catch (err) {
    // Fallo de red: NO se pierde nada. El texto sigue en el formulario y se
    // ofrece el plan B por correo.
    _fbSetSending(false);
    return _fbShowFailure('No hemos podido conectar con el servidor. Tu mensaje sigue aquí.');
  }

  if (!res.ok) {
    _fbSetSending(false);
    if (res.status === 429) {
      return _fbShowFieldError('fb-err-form',
        json.error || 'Has enviado varios mensajes seguidos. Espera un rato antes del siguiente.');
    }
    return _fbShowFailure(json.error || 'El servidor no ha podido guardar tu mensaje. Tu texto sigue aquí.');
  }

  // Éxito: se limpia el borrador para que el próximo feedback salga en blanco.
  _fbDraft  = null;
  _fbRating = 0;
  // Solo el tipo. Nunca el mensaje ni el correo.
  if (typeof track === 'function') track('feedback_enviado', { tipo: d.type });
  _fbShowSuccess();
}

/** Plan B: el mensaje no se pierde y se ofrece enviarlo por correo. */
function _fbShowFailure(msg) {
  const box = document.getElementById('fb-err-form');
  if (!box) { if (typeof showToast === 'function') showToast(msg, 'error'); return; }
  box.innerHTML = '';
  box.style.display = 'block';

  const p = document.createElement('div');
  p.textContent = msg + ' Puedes enviárnoslo por correo:';
  box.appendChild(p);

  const a = document.createElement('a');
  a.className = 'btn-secondary';
  a.style.cssText = 'display:inline-block;margin-top:8px;text-decoration:none';
  a.href = _fbMailtoHref();
  a.textContent = 'Enviar por correo';
  // No se abre en pestaña nueva: un mailto: en _blank deja una pestaña en
  // blanco abierta en la mayoría de navegadores.
  box.appendChild(a);
}

/** mailto: con asunto y cuerpo rellenados. Sin el informe técnico largo. */
function _fbMailtoHref() {
  const d = _fbDraft || _fbSnapshotDraft();
  const label = (_FB_TYPES.find(t => t.v === d.type) || {}).label || 'Feedback';
  const subject = `Finova — ${label}`;
  // El informe técnico NO va en el mailto: un cuerpo de mailto con un JSON
  // dentro se rompe en la mitad de los clientes de correo y lo que importa es
  // que el mensaje llegue. Solo se añade la sección y la versión.
  const body = [
    d.message.trim(),
    '',
    '---',
    `Sección: ${(typeof APP !== 'undefined' && APP.activeSection) || '?'}`,
    `Versión: ${typeof FINOVA_VERSION !== 'undefined' ? FINOVA_VERSION : '?'}`,
  ].join('\n');
  return 'mailto:MyFinova1@gmail.com'
    + '?subject=' + encodeURIComponent(subject)
    + '&body='    + encodeURIComponent(body);
}

function _fbShowSuccess() {
  const ok = document.getElementById('fb-ok');
  if (!ok) { if (typeof showToast === 'function') showToast('Gracias, lo hemos recibido ✓', 'success'); closeModal(); return; }

  // Se sustituye el formulario por el agradecimiento en vez de cerrar de
  // golpe: cerrar el modal sin más deja al usuario sin saber si se envió.
  ['fb-type', 'fb-message', 'fb-email', 'fb-tech'].forEach(id => {
    document.getElementById(id)?.closest('.form-group')?.remove();
  });
  document.getElementById('fb-rating-group')?.remove();
  document.querySelector('.fb-privacy')?.remove();
  document.querySelector('.fb-faq-hint')?.remove();
  document.querySelector('.fb-honeypot')?.remove();
  _fbShowFieldError('fb-err-form', '');

  ok.style.display = 'block';
  ok.innerHTML = `
    <div class="fb-ok-title">Gracias, lo hemos recibido</div>
    <p class="fb-ok-body">
      Leemos todo lo que llega. Si has dejado tu correo, te responderemos en
      cuanto podamos.
    </p>`;

  const btn = document.getElementById('fb-send-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Cerrar';
    btn.style.opacity = '1';
    btn.onclick = () => closeModal();
    btn.focus();
  }
  const cancel = btn?.previousElementSibling;
  if (cancel) cancel.style.display = 'none';
}

/* ─── FAQ dentro de la app ────────────────────────────────────── */

function openFaqModal() {
  if (typeof FINOVA_FAQ === 'undefined') {
    if (typeof showToast === 'function') showToast('No se pudo cargar la ayuda', 'error');
    return;
  }

  openModal('Preguntas frecuentes', `
    <div class="form-group">
      <label class="form-label" for="faq-search">Buscar en la ayuda</label>
      <input type="search" id="faq-search" class="text-input" autocomplete="off"
        placeholder="Por ejemplo: borrar cuenta, importar, precios"
        aria-controls="faq-list" oninput="_faqFilter(this.value)" />
    </div>
    <div id="faq-count" class="fb-hint" aria-live="polite" style="margin-bottom:8px"></div>
    <div id="faq-list" class="faq-list"></div>
    <div class="faq-cta">
      <div class="faq-cta-title">¿No encuentras lo que buscas?</div>
      <p class="faq-cta-body">Pregúntanos directamente y te respondemos.</p>
      <button type="button" class="btn-primary"
        onclick="closeModal(); _withFeedback(null, 'question');">Escríbenos</button>
    </div>`, null);

  const footer = document.getElementById('modal')?.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
  document.getElementById('modal')?.classList.add('modal-wide');

  _faqFilter('');
  setTimeout(() => document.getElementById('faq-search')?.focus(), 80);
}

function _faqFilter(query) {
  const list  = document.getElementById('faq-list');
  const count = document.getElementById('faq-count');
  if (!list) return;

  const items = typeof fvFaqSearch === 'function' ? fvFaqSearch(query) : FINOVA_FAQ;

  if (count) {
    count.textContent = !query ? ''
      : items.length === 0 ? 'Ninguna pregunta coincide'
      : items.length === 1 ? '1 pregunta' : `${items.length} preguntas`;
  }

  if (!items.length) {
    list.innerHTML = `
      <div class="faq-empty">
        No hemos encontrado nada para eso. Prueba con otra palabra, o
        escríbenos con el botón de abajo.
      </div>`;
    return;
  }

  // <details>/<summary> en vez de botones con aria-expanded: el navegador ya
  // da el comportamiento accesible, el teclado y el estado, sin JS de por
  // medio. Con una búsqueda activa se abren solos, que es lo que se espera al
  // filtrar.
  const openAll = !!query;
  list.innerHTML = items.map(e => `
    <details class="faq-item"${openAll ? ' open' : ''}>
      <summary class="faq-q">
        <span>${typeof escapeHtml === 'function' ? escapeHtml(e.q) : e.q}</span>
        <svg class="icon icon-sm faq-chevron" aria-hidden="true"><use href="#icon-chevron-right"></use></svg>
      </summary>
      <div class="faq-a">${e.a}</div>
    </details>`).join('');
}
