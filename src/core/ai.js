/* ═══════════════════════════════════════════════════════════════
   FINOVA — ai.js
   Sección 28: Asesor IA — Gemini, OpenAI, Claude
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   28. ASESOR IA — MULTI-PROVEEDOR
═══════════════════════════════════════════════════════════════ */

let aiHistory = [];
const AI_MAX_HISTORY = 10; // últimos 5 turnos de conversación enviados a la API

// Controla si se adjuntan datos financieros al system prompt (sesión, no persiste)
let _aiSendContext = true;

// null = aún no comprobado, false = sin clave servidor, true = servidor tiene clave propia
let _serverAI = null;
let _serverProvider = 'claude';

async function initServerAI() {
  if (_serverAI !== null) return;
  _serverAI = false;
  try {
    const res = await fetch('/api/ai-status', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      _serverAI = !!data.serverAI;
      if (data.serverProvider) _serverProvider = data.serverProvider;
    }
  } catch {}
  renderAI();
  _renderServerAIBanner();
}

function _renderServerAIBanner() {
  const el = document.getElementById('settings-server-ai-banner');
  if (!el) return;
  if (_serverAI === true) {
    const providerLabel = { claude: 'Claude', groq: 'Groq', openai: 'ChatGPT', gemini: 'Gemini' }[_serverProvider] || _serverProvider;
    el.style.display = 'block';
    el.style.background = 'rgba(var(--up-rgb),.1)';
    el.style.border = '1px solid rgba(var(--up-rgb),.25)';
    el.style.color = 'var(--up)';
    el.innerHTML = `✓ Tu servidor tiene <strong>${providerLabel}</strong> configurado — el Asesor IA funciona sin necesidad de introducir ninguna clave.`;
  } else {
    el.style.display = 'none';
  }
}

function toggleAiContext() {
  _aiSendContext = !_aiSendContext;
  const btn = document.getElementById('ai-ctx-btn');
  if (btn) {
    btn.textContent    = _aiSendContext ? '📊 Con datos' : '🔒 Sin datos';
    btn.title          = _aiSendContext
      ? 'Tus datos financieros se envían a la IA — pulsa para desactivar'
      : 'Modo anónimo: no se envían datos financieros — pulsa para activar';
    btn.style.opacity  = _aiSendContext ? '1' : '0.55';
  }
  const banner = document.getElementById('ai-ctx-banner');
  if (banner) banner.style.display = _aiSendContext ? 'none' : '';
}

const AI_PROVIDERS = {
  claude: {
    label: 'Claude',
    icon:  '✦',
    color: '#c8a96e',
    placeholder: 'sk-ant-api03-...',
    keyField: 'claudeApiKey',
    hint: 'console.anthropic.com → API Keys',
  },
  openai: {
    label: 'ChatGPT',
    icon:  '⊕',
    color: '#10a37f',
    placeholder: 'sk-proj-...',
    keyField: 'openaiApiKey',
    hint: 'platform.openai.com → API Keys',
  },
  gemini: {
    label: 'Gemini',
    icon:  '◆',
    color: '#4285f4',
    placeholder: 'AIza...',
    keyField: 'geminiApiKey',
    hint: 'aistudio.google.com → Get API Key',
  },
  groq: {
    label: 'Groq',
    icon:  '⚡',
    color: '#f55036',
    placeholder: 'gsk_...',
    keyField: 'groqApiKey',
    hint: 'console.groq.com → API Keys (gratis, sin tarjeta)',
  },
};

function getActiveProviderKey() {
  const p = AI_PROVIDERS[APP.aiProvider] || AI_PROVIDERS.claude;
  return (APP[p.keyField] || '').trim();
}

function setAiProvider(provider) {
  if (!AI_PROVIDERS[provider]) return;
  APP.aiProvider = provider;
  saveData();
  aiHistory = [];
  renderAI();
}

function _aiProviderUrl(provider) {
  return { claude: 'https://console.anthropic.com', openai: 'https://platform.openai.com/api-keys', gemini: 'https://aistudio.google.com/apikey', groq: 'https://console.groq.com/keys' }[provider] || '#';
}

function renderAI() {
  // Comprobar clave del servidor en primer render
  if (_serverAI === null) { initServerAI(); }

  const provider = APP.aiProvider || 'claude';
  const meta     = AI_PROVIDERS[provider] || AI_PROVIDERS.claude;
  // El IA está disponible si el usuario tiene su propia clave O si el servidor tiene una
  const hasKey   = !!getActiveProviderKey() || _serverAI === true;

  // Actualizar tabs de proveedor
  document.querySelectorAll('.ai-provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === provider);
  });

  // Nokey card — contenido dinámico según proveedor
  const nokey   = document.getElementById('ai-nokey-card');
  const nokeyBody = document.getElementById('ai-nokey-content');
  if (nokey) nokey.style.display = hasKey ? 'none' : 'block';
  if (nokeyBody && !hasKey) {
    const isGroq = provider === 'groq';
    const url    = _aiProviderUrl(provider);
    nokeyBody.innerHTML = `
      <div class="ai-setup-wrap">
        <div class="ai-setup-hero">
          <span class="ai-setup-hero-icon">${meta.icon}</span>
          <div>
            <div class="ai-setup-hero-title">Activa el Asesor IA de Finova</div>
            <div class="ai-setup-hero-sub">Analiza tus finanzas en lenguaje natural. Responde con tus datos reales.</div>
          </div>
        </div>
        <div class="ai-setup-examples">
          <span class="ai-setup-ex">"¿Cuánto he gastado este mes en restaurantes?"</span>
          <span class="ai-setup-ex">"¿Estoy en camino de cumplir mi objetivo?"</span>
          <span class="ai-setup-ex">"Analiza mi cartera y dime si estoy diversificado"</span>
        </div>
        ${!isGroq ? `<div class="ai-setup-free-tip">⚡ <strong>Empieza gratis sin tarjeta:</strong> <button class="ai-link-btn" onclick="setAiProvider('groq')">usa Groq →</button></div>` : ''}
        <div class="ai-setup-form">
          <div class="ai-setup-step-label">Cómo activarlo en 2 pasos ${isGroq ? '<span class="ai-badge-free">gratis · sin tarjeta</span>' : ''}</div>
          <ol class="ai-setup-steps-list">
            <li>Ve a <strong><a href="${url}" target="_blank" rel="noopener">${meta.hint.split('→')[0].trim()}</a></strong>, crea una cuenta y copia tu clave API</li>
            <li>Pégala aquí y pulsa activar:</li>
          </ol>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
            <input type="password" id="ai-inline-key" class="text-input" placeholder="${meta.placeholder}" autocomplete="off" style="flex:1;min-width:180px" onkeydown="if(event.key==='Enter')aiSaveInlineKey()" />
            <button class="btn-primary" onclick="aiSaveInlineKey()">Activar IA →</button>
          </div>
          <div class="ai-setup-privacy">🔒 Tu clave se guarda solo en este dispositivo — nunca sale de tu navegador.</div>
        </div>
      </div>`;
  }

  renderAIMessages();
  _renderServerAIBanner();
}


async function aiSaveInlineKey() {
  const input = document.getElementById('ai-inline-key');
  const key   = (input?.value || '').trim();
  if (!key) { showToast('Introduce una API Key válida', 'error'); return; }
  const provider = APP.aiProvider || 'claude';
  const meta     = AI_PROVIDERS[provider];
  APP[meta.keyField] = key;
  await saveApiKey(provider, key);
  saveData();
  showToast(`API Key de ${meta.label} guardada ✓`, 'success');
  renderAI();
}

function buildFinancialContext() {
  const cash  = calcCashTotal();
  const inv   = calcPortfolioValue();
  const alt   = calcAlternativesTotal();
  const prop  = calcPropertiesTotal();
  const total = cash + inv + alt + prop;

  const m       = getCurrentMonth();
  const safeTransactions = APP.transactions.map(({ photo, photoId, ...rest }) => rest);
  const txMonth = safeTransactions.filter(t => (t.date || m).startsWith(m));
  const inc     = txMonth.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp     = txMonth.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Top 5 categorías de gasto (solo importes)
  const byCat = {};
  txMonth.filter(t => t.type === 'expense').forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, a]) => `${c}:${formatCurrency(a)}`).join(', ');

  // Top 5 activos por valor
  const topPortfolio = [...APP.portfolio]
    .map(a => ({ ...a, val: a.currentPrice * a.quantity, gain: (a.currentPrice - a.buyPrice) * a.quantity }))
    .sort((a, b) => b.val - a.val).slice(0, 5)
    .map(a => `${a.ticker || a.name}${a.sector ? '[' + a.sector + ']' : ''}:${formatCurrency(a.val)}(${a.gain >= 0 ? '+' : ''}${formatCurrency(a.gain)})`).join(', ')
    || 'Sin activos';

  // Dividendos anuales
  const divAnual = APP.dividends.reduce((s, d) => {
    return s + d.dividendPerShare * d.shares * ({ annual: 1, semiannual: 2, quarterly: 4, monthly: 12 }[d.frequency] || 1);
  }, 0);

  // Objetivos (máx 4) — usa progreso real calculado, no el campo manual
  const goals = APP.goals.slice(0, 4)
    .map(g => {
      const progress = typeof _calcGoalProgress === 'function' ? _calcGoalProgress(g) : (g.currentAmount || 0);
      return `${g.name}:${formatCurrency(progress)}/${formatCurrency(g.targetAmount)}`;
    }).join(', ') || 'Sin objetivos';

  const propsCtx = (APP.properties || []).length > 0
    ? `, inmuebles:${formatCurrency(prop)}(${APP.properties.length})`
    : '';
  return `[FINOVA ${new Date().toLocaleDateString('es-ES')}]
Patrimonio: ${formatCurrency(total)} (efectivo:${formatCurrency(cash)}, inversión:${formatCurrency(inv)}, alt:${formatCurrency(alt)}${propsCtx})
Mes ${m}: ingresos ${formatCurrency(inc)}, gastos ${formatCurrency(exp)}, balance ${formatCurrency(inc - exp)}
Top gastos: ${topCats || 'ninguno'}
Cartera (${APP.portfolio.length}): ${topPortfolio}
Dividendos anuales: ${formatCurrency(divAnual)}
Objetivos: ${goals}
Transacciones: ${safeTransactions.length} | Watchlist: ${APP.watchlist.length} | Bizums pendientes: ${APP.bizums.filter(b => b.status === 'pending').length}`;
}

function buildSystemPrompt() {
  const contextBlock = _aiSendContext
    ? `Tienes acceso en tiempo real a los datos financieros del usuario.\n\n${buildFinancialContext()}\n`
    : `El usuario ha activado el modo anónimo: no tienes acceso a sus datos financieros. Responde preguntas generales de finanzas personales sin hacer referencia a cifras concretas del usuario.\n`;
  return `Eres Finova AI, el asesor financiero personal integrado en la app Finova.
${contextBlock}
Instrucciones:
- Responde siempre en español
- Usa los datos reales del usuario para dar consejos personalizados con números concretos
- Usa formato markdown básico (negritas con **, listas con -, saltos de línea) para estructurar respuestas
- Usa el formato europeo de moneda (€1.234,56)
- Si el usuario no tiene datos en alguna categoría, díselo
- No garantices rentabilidades ni des consejos de inversión ilegales`;
}

function apiError(status, label) {
  if (status === 401 || status === 403) return `API Key de ${label} inválida o sin permisos. Actualízala en Ajustes.`;
  if (status === 402 || status === 529) return `Sin créditos en ${label}. Ve a la web del proveedor → Billing y añade saldo, o cambia de proveedor con los tabs de arriba.`;
  if (status === 429) return `Demasiadas peticiones a ${label}. Espera unos segundos e inténtalo de nuevo.`;
  if (status === 400) return `Solicitud incorrecta a ${label} (400). Comprueba tu API Key.`;
  if (status >= 500) return `El servidor de ${label} está caído (${status}). Inténtalo más tarde.`;
  return `Error ${status} de ${label}.`;
}

/* ─── Fallback & error helpers ────────────────────────────────────────────── */

const AI_FALLBACK_ORDER = ['claude', 'openai', 'gemini', 'groq'];

function _isTemporaryError(status) {
  return status === 429 || status === 402 || status === 529 || status >= 500;
}

function _extractStatus(err) {
  const m = (err.message || '').match(/\b([45]\d{2})\b/);
  return m ? parseInt(m[1], 10) : 0;
}

function _getAvailableProviders() {
  return AI_FALLBACK_ORDER.filter(p => {
    const meta = AI_PROVIDERS[p];
    return meta && (APP[meta.keyField] || '').trim();
  });
}

function _aiSmartError(err, providerLabel) {
  if (err instanceof TypeError) {
    return 'Sin conexión a internet. Comprueba tu red e inténtalo de nuevo.';
  }
  const msg = err.message || '';
  if (msg.includes('inválida') || msg.includes('sin permisos')) {
    return `La API Key de ${providerLabel} no es válida. Ve a **Ajustes → IA** para actualizarla.`;
  }
  if (msg.includes('créditos') || msg.includes('Billing') || msg.includes('402')) {
    return `${providerLabel} ha agotado tu crédito. Añade saldo en la web del proveedor o configura otro en **Ajustes → IA**.`;
  }
  if (msg.includes('Demasiadas') || msg.includes('429') || msg.includes('rate')) {
    return `${providerLabel} está saturado ahora mismo. Espera unos segundos e inténtalo de nuevo.`;
  }
  if (msg.includes('caído') || msg.includes('503') || msg.includes('502')) {
    return `El servidor de ${providerLabel} no está disponible. Inténtalo en unos minutos.`;
  }
  return msg || `Error inesperado con ${providerLabel}. Inténtalo de nuevo.`;
}

function _aiLocalFallback(question) {
  const q = (question || '').toLowerCase();
  let tip = '';
  if (q.includes('ahorro') || q.includes('ahorrar')) {
    tip = 'Como punto de partida, intenta destinar al menos el **20% de tus ingresos al ahorro** (regla 50/30/20). Define metas concretas en la sección *Objetivos*.';
  } else if (q.includes('invers') || q.includes('bolsa') || q.includes('fondo') || q.includes('etf')) {
    tip = 'Para el largo plazo, los fondos indexados de bajo coste son la base más sólida. Gestiona tu cartera en la sección *Cartera*.';
  } else if (q.includes('deuda') || q.includes('préstamo') || q.includes('hipoteca') || q.includes('crédito')) {
    tip = 'La estrategia **avalanche** (liquidar primero la deuda de mayor interés) minimiza el coste total. Consulta tus pasivos en la sección *Pasivos*.';
  } else if (q.includes('presupuesto') || q.includes('gasto') || q.includes('budget')) {
    tip = 'Revisa tus gastos por categoría en *Transacciones* y activa los filtros por mes para detectar patrones de consumo.';
  } else {
    tip = 'Configura una API Key válida en **Ajustes → IA** para obtener análisis personalizados. Groq ofrece un nivel gratuito en *console.groq.com* sin necesidad de tarjeta.';
  }
  return `**Asistente IA no disponible en este momento**\n\n${tip}\n\n_Todos los proveedores configurados están saturados o sin crédito. Comprueba tus claves en **Ajustes → IA**._`;
}

async function callViaProxy(provider, apiKey, systemPrompt) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey, messages: aiHistory.slice(-AI_MAX_HISTORY), systemPrompt }),
  });
  if (res.status === 405 || res.status === 404) {
    return callDirect(provider, apiKey, systemPrompt);
  }
  if (res.status === 429) {
    showToast('Límite de IA alcanzado, espera 60 s', 'error');
    setTimeout(() => {
      const btn = document.getElementById('ai-send-btn');
      if (btn) { btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 60000); }
    }, 0);
    throw new Error('__rate_limited__');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.text || '';
}

async function callDirect(provider, apiKey, systemPrompt) {
  if (provider === 'openai') return callOpenAIDirect(apiKey, systemPrompt);
  if (provider === 'gemini') return callGeminiDirect(apiKey, systemPrompt);
  if (provider === 'groq')   return callGroqDirect(apiKey, systemPrompt);
  return callClaudeDirect(apiKey, systemPrompt);
}

async function callGroqDirect(apiKey, systemPrompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...aiHistory.slice(-AI_MAX_HISTORY).map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || apiError(res.status, 'Groq'));
  return data.choices?.[0]?.message?.content || '';
}

async function callClaudeDirect(apiKey, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: aiHistory.slice(-AI_MAX_HISTORY).map(m => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || apiError(res.status, 'Claude'));
  return data.content?.[0]?.text || '';
}

async function callOpenAIDirect(apiKey, systemPrompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...aiHistory.slice(-AI_MAX_HISTORY).map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || apiError(res.status, 'ChatGPT'));
  return data.choices?.[0]?.message?.content || '';
}

async function callGeminiDirect(apiKey, systemPrompt) {
  const contents = aiHistory.slice(-AI_MAX_HISTORY).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || apiError(res.status, 'Gemini'));
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    if (data.candidates?.[0]?.finishReason === 'SAFETY') throw new Error('Gemini bloqueó la respuesta por filtros de seguridad.');
    throw new Error('Gemini no devolvió respuesta. Inténtalo de nuevo.');
  }
  return text;
}

async function callClaude(systemPrompt) {
  const apiKey = (APP.claudeApiKey || '').trim();
  if (!apiKey) throw new Error('No hay API Key de Claude. Configúrala arriba.');
  return callViaProxy('claude', apiKey, systemPrompt);
}

async function callOpenAI(systemPrompt) {
  const apiKey = (APP.openaiApiKey || '').trim();
  if (!apiKey) throw new Error('No hay API Key de ChatGPT. Configúrala arriba.');
  return callViaProxy('openai', apiKey, systemPrompt);
}

async function callGemini(systemPrompt) {
  const apiKey = (APP.geminiApiKey || '').trim();
  if (!apiKey) throw new Error('No hay API Key de Gemini. Configúrala en Ajustes.');
  return callViaProxy('gemini', apiKey, systemPrompt);
}

async function callGroq(systemPrompt) {
  const apiKey = (APP.groqApiKey || '').trim();
  if (!apiKey) throw new Error('No hay API Key de Groq. Configúrala arriba.');
  return callViaProxy('groq', apiKey, systemPrompt);
}

async function _callProvider(provider, systemPrompt, onChunk = null) {
  const meta   = AI_PROVIDERS[provider];
  if (!meta) throw new Error(`Proveedor desconocido: ${provider}`);
  const apiKey = (APP[meta.keyField] || '').trim();
  if (!apiKey) throw new Error(`Sin API Key — ${meta.label}`);
  if (onChunk) return _callDirectStream(provider, apiKey, systemPrompt, onChunk);
  return callViaProxy(provider, apiKey, systemPrompt);
}

async function callAI(onChunk = null) {
  const sys = buildSystemPrompt();

  // Server-side key — delegate to proxy (no streaming support on proxy path)
  if (_serverAI === true && !getActiveProviderKey()) {
    return callViaProxy(_serverProvider, '', sys);
  }

  const primary   = APP.aiProvider || 'claude';
  const available = _getAvailableProviders();

  if (available.length === 0) {
    const meta = AI_PROVIDERS[primary] || AI_PROVIDERS.claude;
    throw new Error(`No hay API Key de ${meta.label}. Configúrala en Ajustes → IA.`);
  }

  // Build trial order: primary first, then fallbacks
  const toTry  = [primary, ...AI_FALLBACK_ORDER.filter(p => p !== primary)]
    .filter(p => available.includes(p));
  const errors = [];

  for (let i = 0; i < toTry.length; i++) {
    const provider = toTry[i];
    try {
      if (i > 0) {
        showToast(`${AI_PROVIDERS[toTry[0]]?.label || 'Proveedor'} no disponible — usando ${AI_PROVIDERS[provider].label}`, 'info');
      }
      return await _callProvider(provider, sys, onChunk);
    } catch (err) {
      errors.push({ provider, err });
      if (i < toTry.length - 1) continue;

      const permErr = errors.find(e => {
        const s = _extractStatus(e.err);
        return s === 401 || s === 403 || s === 400;
      });
      if (permErr && errors.length === 1) {
        throw new Error(_aiSmartError(permErr.err, AI_PROVIDERS[permErr.provider]?.label || permErr.provider));
      }
      throw new Error('__all_failed__');
    }
  }

  throw new Error('__all_failed__');
}

/* ─── Streaming helpers ───────────────────────────────────────────────────── */

async function _readOpenAIStream(res, onChunk) {
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '', buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const chunk = JSON.parse(raw).choices?.[0]?.delta?.content || '';
        if (chunk) { text += chunk; onChunk(chunk); }
      } catch {}
    }
  }
  return text;
}

async function _callGroqStream(apiKey, systemPrompt, onChunk) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile', max_tokens: 1024, stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...aiHistory.slice(-AI_MAX_HISTORY).map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || apiError(res.status, 'Groq')); }
  return _readOpenAIStream(res, onChunk);
}

async function _callOpenAIStream(apiKey, systemPrompt, onChunk) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini', max_tokens: 1024, stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...aiHistory.slice(-AI_MAX_HISTORY).map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || apiError(res.status, 'ChatGPT')); }
  return _readOpenAIStream(res, onChunk);
}

async function _callClaudeStream(apiKey, systemPrompt, onChunk) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022', max_tokens: 1024, stream: true,
      system: systemPrompt,
      messages: aiHistory.slice(-AI_MAX_HISTORY).map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || apiError(res.status, 'Claude')); }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '', buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const json = JSON.parse(line.slice(6).trim());
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          const chunk = json.delta.text || '';
          if (chunk) { text += chunk; onChunk(chunk); }
        }
      } catch {}
    }
  }
  return text;
}

async function _callGeminiStream(apiKey, systemPrompt, onChunk) {
  const contents = aiHistory.slice(-AI_MAX_HISTORY).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt }] }, contents }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || apiError(res.status, 'Gemini')); }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '', buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const chunk = JSON.parse(line.slice(6).trim()).candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (chunk) { text += chunk; onChunk(chunk); }
      } catch {}
    }
  }
  return text;
}

function _callDirectStream(provider, apiKey, systemPrompt, onChunk) {
  if (provider === 'openai') return _callOpenAIStream(apiKey, systemPrompt, onChunk);
  if (provider === 'gemini') return _callGeminiStream(apiKey, systemPrompt, onChunk);
  if (provider === 'groq')   return _callGroqStream(apiKey, systemPrompt, onChunk);
  return _callClaudeStream(apiKey, systemPrompt, onChunk);
}

function aiAsk(question) {
  const input = document.getElementById('ai-input');
  if (input) {
    input.value = question;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }
  aiSend();
}

async function aiSend() {
  const input   = document.getElementById('ai-input');
  const message = (input?.value || '').trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';

  aiHistory.push({ role: 'user', content: message });
  renderAIMessages();
  aiSetLoading(true);

  const msgs = document.getElementById('ai-messages');
  let streamRow    = null;
  let streamBubble = null;
  let streamText   = '';

  function onChunk(chunk) {
    streamText += chunk;
    if (!streamRow) {
      // First chunk: swap typing indicator for live text bubble
      document.getElementById('ai-typing-row')?.remove();
      streamRow = document.createElement('div');
      streamRow.id        = 'ai-stream-row';
      streamRow.className = 'ai-message ai-assistant';
      const icon = AI_PROVIDERS[APP.aiProvider]?.icon || '✦';
      streamRow.innerHTML = `<div class="ai-avatar">${icon}</div><div class="ai-bubble" id="ai-stream-bubble"></div>`;
      msgs?.appendChild(streamRow);
      streamBubble = document.getElementById('ai-stream-bubble');
    }
    if (streamBubble) {
      streamBubble.textContent = streamText; // plain text during stream; markdown applied on final render
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
  }

  try {
    const reply = await callAI(onChunk);
    aiHistory.push({ role: 'assistant', content: reply || streamText });
  } catch (err) {
    if (err.message !== '__rate_limited__') {
      let content;
      if (err.message === '__all_failed__') {
        const lastUser = [...aiHistory].reverse().find(m => m.role === 'user');
        content = _aiLocalFallback(lastUser?.content || '');
      } else {
        const prov = AI_PROVIDERS[APP.aiProvider]?.label || 'la IA';
        content = '⚠ ' + (err instanceof TypeError
          ? 'Sin conexión a internet. Comprueba tu red e inténtalo de nuevo.'
          : _aiSmartError(err, prov));
      }
      aiHistory.push({ role: 'assistant', content });
    }
  } finally {
    aiSetLoading(false);
    document.getElementById('ai-stream-row')?.remove(); // replaced by full renderAIMessages below
    renderAIMessages();
  }
}

function aiSetLoading(on) {
  const sendBtn = document.getElementById('ai-send-btn');
  if (sendBtn) sendBtn.disabled = on;

  const msgs = document.getElementById('ai-messages');
  if (!msgs) return;

  const existing = document.getElementById('ai-typing-row');
  if (on && !existing) {
    const div = document.createElement('div');
    div.id        = 'ai-typing-row';
    div.className = 'ai-message ai-assistant';
    const icon = AI_PROVIDERS[APP.aiProvider]?.icon || '✦';
    div.innerHTML = `<div class="ai-avatar">${icon}</div><div class="ai-bubble ai-typing-bubble"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  } else if (!on && existing) {
    existing.remove();
  }
}

function renderAIMessages() {
  const container   = document.getElementById('ai-messages');
  const suggestions = document.getElementById('ai-suggestions');
  if (!container) return;

  if (aiHistory.length === 0) {
    container.innerHTML = `
      <div class="ai-welcome">
        <div class="ai-welcome-icon">✦</div>
        <h3 class="ai-welcome-title">Bienvenido al Asesor IA</h3>
        <p class="ai-welcome-desc">Pregúntame sobre tus finanzas. Tengo acceso completo a todos tus datos de Finova y puedo darte análisis personalizados.</p>
      </div>`;
    if (suggestions) suggestions.style.display = '';
    return;
  }

  if (suggestions) suggestions.style.display = 'none';

  container.innerHTML = aiHistory.map(msg => `
    <div class="ai-message ai-${msg.role}">
      ${msg.role === 'assistant' ? `<div class="ai-avatar">${AI_PROVIDERS[APP.aiProvider]?.icon || '✦'}</div>` : ''}
      <div class="ai-bubble">${msg.role === 'user' ? escapeHtml(msg.content) : renderMarkdown(msg.content)}</div>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;
}

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines   = html.split('\n');
  const out     = [];
  let listTag   = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (/^[-•]\s/.test(line)) {
      if (listTag !== 'ul') {
        if (listTag) out.push(`</${listTag}>`);
        out.push('<ul>'); listTag = 'ul';
      }
      out.push(`<li>${line.replace(/^[-•]\s/, '')}</li>`);
    } else if (/^\d+\.\s/.test(line)) {
      if (listTag !== 'ol') {
        if (listTag) out.push(`</${listTag}>`);
        out.push('<ol>'); listTag = 'ol';
      }
      out.push(`<li>${line.replace(/^\d+\.\s/, '')}</li>`);
    } else {
      if (listTag) { out.push(`</${listTag}>`); listTag = null; }
      if (line === '') {
        out.push('<br>');
      } else if (/^#{1,3}\s/.test(line)) {
        out.push(`<strong>${line.replace(/^#{1,3}\s/, '')}</strong>`);
      } else {
        out.push(`<p>${line}</p>`);
      }
    }
  }
  if (listTag) out.push(`</${listTag}>`);

  return out.join('');
}

function aiClearHistory() {
  aiHistory = [];
  renderAI();
}

/* ─── Análisis de hábitos ─────────────────────────────────────── */
function buildHabitsContext() {
  const now    = new Date();
  const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

  const txs = APP.transactions.filter(t => {
    const p = t.date.split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d >= cutoff && d <= now;
  });

  if (txs.length < 5) return null;

  const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const byDow = Array(7).fill(0);
  txs.filter(t => t.type === 'expense').forEach(t => {
    const p = t.date.split('-');
    byDow[new Date(+p[0], +p[1] - 1, +p[2]).getDay()] += t.amount;
  });

  const byMonth = {};
  txs.forEach(t => {
    const mo = t.date.slice(0, 7);
    if (!byMonth[mo]) byMonth[mo] = { income: 0, expense: 0 };
    byMonth[mo][t.type] += t.amount;
  });

  const months  = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
  const savings = months.map(([mo, v]) => ({ month: mo, savings: v.income - v.expense, income: v.income, expense: v.expense }));
  const best    = [...savings].sort((a, b) => b.savings - a.savings)[0];
  const worst   = [...savings].sort((a, b) => a.savings - b.savings)[0];

  const byCat = {};
  txs.filter(t => t.type === 'expense').forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([c, a]) => `${c}:${formatCurrency(a)}`).join(', ');

  const totalIncome  = txs.filter(t => t.type === 'income').reduce((s, t)  => s + t.amount, 0);
  const totalExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const savingsRate  = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100).toFixed(1) : '0';

  const activeDow   = byDow.filter(v => v > 0);
  const avgDow      = activeDow.length ? activeDow.reduce((s, v) => s + v, 0) / activeDow.length : 0;
  const maxDow      = byDow.indexOf(Math.max(...byDow));
  const pctAbove    = avgDow > 0 ? Math.round((byDow[maxDow] - avgDow) / avgDow * 100) : 0;

  const dowStr = byDow.map((v, i) => v > 0 ? `${DOW[i]}:${formatCurrency(v)}` : null).filter(Boolean).join(', ');
  const monthlyStr = savings.map(s =>
    `${s.month}: ingresos ${formatCurrency(s.income)}, gastos ${formatCurrency(s.expense)}, ahorro ${formatCurrency(s.savings)}`
  ).join('\n');

  return `ANÁLISIS DE HÁBITOS — últimos 12 meses (${txs.length} transacciones)
Periodo: ${months[0] ? months[0][0] : 'N/A'} → ${months[months.length - 1] ? months[months.length - 1][0] : 'N/A'}
Total ingresos: ${formatCurrency(totalIncome)} | Total gastos: ${formatCurrency(totalExpense)} | Tasa de ahorro: ${savingsRate}%

Gasto acumulado por día de la semana:
${dowStr}
Día con más gasto: ${DOW[maxDow]} (${pctAbove}% por encima de la media diaria)

Mejor mes (más ahorro): ${best ? best.month : 'N/A'} (${formatCurrency(best ? best.savings : 0)})
Peor mes (menos ahorro): ${worst ? worst.month : 'N/A'} (${formatCurrency(worst ? worst.savings : 0)})

Top categorías de gasto (12 meses):
${topCats}

Desglose mensual:
${monthlyStr}`;
}

async function aiAnalyzeHabits() {
  const ctx = buildHabitsContext();
  if (!ctx) { showToast('Necesitas al menos 5 transacciones del último año para analizar hábitos', 'error'); return; }

  const spinnerHtml = `<div style="text-align:center;padding:32px 0">
    <div style="display:inline-flex;gap:5px">
      <span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>
    </div>
    <div style="margin-top:16px;font-size:13px;color:var(--text-muted)">Analizando tus hábitos financieros…</div>
  </div>`;

  openModal('📊 Análisis de hábitos', spinnerHtml, null, null);
  const modalFooter = document.getElementById('modal').querySelector('.modal-footer');
  if (modalFooter) modalFooter.style.display = 'none';

  const prompt = `Analiza mis hábitos de gasto del último año con los siguientes datos y dame un informe con: (1) patrones temporales — qué días gasto más y si hay estacionalidad mensual, (2) mejor y peor época de ahorro, (3) principales categorías de gasto y si hay excesos, (4) si mi tasa de ahorro es saludable, (5) 3 recomendaciones concretas para mejorar.\n\n${ctx}`;

  const savedHistory = aiHistory;
  aiHistory = [{ role: 'user', content: prompt }];
  try {
    const reply = await callAI();
    aiHistory = savedHistory;
    document.getElementById('modalBody').innerHTML = `<div style="max-height:60vh;overflow-y:auto;padding-right:4px">${renderMarkdown(reply)}</div>`;
    if (modalFooter) {
      modalFooter.style.display = '';
      const cancelBtn = document.getElementById('modalCancel');
      if (cancelBtn) cancelBtn.textContent = 'Cerrar';
      const confirmBtn = document.getElementById('modalConfirm');
      if (confirmBtn) confirmBtn.style.display = 'none';
    }
  } catch (err) {
    aiHistory = savedHistory;
    let msg;
    if (err.message === '__all_failed__') {
      msg = 'Todos los proveedores de IA están saturados en este momento. Inténtalo más tarde o comprueba tus API Keys en Ajustes → IA.';
    } else {
      const prov = AI_PROVIDERS[APP.aiProvider]?.label || 'la IA';
      msg = err instanceof TypeError
        ? 'Sin conexión a internet. Comprueba tu red.'
        : _aiSmartError(err, prov);
    }
    document.getElementById('modalBody').innerHTML = `<p style="color:var(--text-secondary);padding:16px 0">ℹ ${escapeHtml(msg)}</p>`;
    if (modalFooter) modalFooter.style.display = '';
  }
}

