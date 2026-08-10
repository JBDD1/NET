'use strict';

/* ═══════════════════════════════════════════════════════════════
   FINOVA — STATE
   APP global state object, reactive Store wrapper, and category
   defaults. Loaded first — everything else depends on this.
═══════════════════════════════════════════════════════════════ */

const DEFAULT_CATEGORIES = {
  income:  ['Salario', 'Freelance', 'Alquiler', 'Dividendos', 'Venta', 'Otros ingresos'],
  expense: ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Educación',
            'Ocio', 'Ropa', 'Suscripciones', 'Seguros', 'Restaurantes',
            'Fiesta', 'Amigos', 'Otros gastos']
};

let APP = {
  // Categorías de ingresos y gastos
  categories: structuredClone(DEFAULT_CATEGORIES),

  // Transacciones: { id, date, description, category, type:'income'|'expense', amount, note?, photo?, favorite? }
  transactions: [],

  // Presupuestos por categoría: { id, category, monthlyAmount }
  budgets: [],

  // Activos de cartera: { id, name, ticker, buyPrice, currentPrice, quantity }
  portfolio: [],

  // Watchlist: { id, name, ticker, currentPrice, targetPrice, alertType:'above'|'below', notes }
  watchlist: [],

  // Dividendos: { id, assetName, ticker, dividendPerShare, frequency:'annual'|'semiannual'|'quarterly'|'monthly', shares }
  dividends: [],

  // Cuentas de efectivo: { id, name, amount }
  cashAccounts: [],

  // Activos alternativos: { id, name, category, buyPrice, currentPrice, purchaseDate, notes }
  alternatives: [],

  // Inmuebles: { id, name, type, address, purchasePrice, currentValue, monthlyRent, purchaseDate, notes }
  properties: [],

  // Objetivos: { id, name, emoji, targetAmount, currentAmount, deadline }
  goals: [],

  // Bizums: { id, date, person, concept, direction:'in'|'out', amount, status:'pending'|'done' }
  bizums: [],

  // Histórico de patrimonio para la gráfica: [{ date: 'YYYY-MM', value }]
  networthHistory: [],

  // Snapshots anuales de posiciones de cartera para historial de activos
  portfolioSnapshots: [],

  // Sincronización entre dispositivos
  syncCode: '',
  lastBackupDate: '',

  // Ventas registradas para fiscalidad: { id, name, ticker, buyDate, sellDate, buyPrice, sellPrice, quantity, isCrypto }
  sales: [],

  // Escenarios guardados del simulador: { id, name, initial, monthly, rate, years, finalValue, savedAt }
  scenarios: [],

  // Crypto Staking — posiciones activas: { id, coin, name, amountEur, apy, lockDays, startDate, rewardsEur }
  stakingPositions: [],

  // Crypto Staking — historial: { id, date, coin, type:'stake'|'unstake'|'reward', amountEur, rewards, status:'completed'|'pending' }
  stakingHistory: [],

  // Pasivos & Deudas: { id, name, type:'hipoteca'|'prestamo'|'tarjeta'|'otro', originalAmount, remainingAmount, monthlyPayment, interestRate, startDate, notes }
  liabilities: [],

  // Datos laborales: { salariBruto, retencionEmpresa, seguridadSocial, dietas, sindicatos, otrosGastos }
  trabajo: {
    salarioBruto: 0,
    retencionEmpresa: 0,
    seguridadSocial: 0,
    dietas: 0,
    sindicatos: 0,
    otrosGastos: 0,
  },

  // Mínimos personales y familiares
  minimos: {
    edad: 0,
    discapacidad: 0,
    hijos: [],
    ascendientes: [],
    movilidadGeografica: false,
  },

  // Fecha de última actualización de tipos de cambio (YYYY-MM-DD), null = nunca
  exchangeRatesUpdated: null,

  // Tema actual
  theme: 'dark',

  // Variante de diseño (apariencia)
  variant: 'obsidian-brass',

  // Sección activa
  activeSection: 'dashboard',

  // Proveedor IA activo: 'claude' | 'openai' | 'gemini' | 'groq'
  aiProvider: 'claude',

  // API Keys por proveedor (guardadas también por separado en localStorage)
  claudeApiKey: '',
  openaiApiKey: '',
  geminiApiKey: '',
  groqApiKey: '',

  // Patrones aprendidos: { keyword → category }
  categoryPatterns: {},

  // Modo privacidad
  privacyMode: false,

  // Estado visual del sidebar (se persiste entre recargas)
  sidebarCollapsed: false,

  // Sección de categorías en ajustes: colapsada o no
  categoriesCollapsed: false,

  // Orden de secciones en la sidebar: array de keys
  sectionOrder: [],

  // Nombre mostrado en el perfil de la sidebar
  userName: '',

  // Layout personalizado del dashboard: [{ id, visible }] o null (por defecto)
  dashboardLayout: null,
  dashboardKpis:   null,

  // Indica que el usuario eligió empezar desde cero (no cargar demo)
  freshStart: false,

  // Onboarding
  onboardingDone: false,
  onboardingProfile: null,

  // Último estado del simulador (persiste entre navegaciónes)
  simulatorDraft: { initial: '', monthly: '', rate: '', years: '', hasResult: false },

  // Timestamp (ms) de la última actualización automática de precios
  lastPriceRefresh: null,

  // Alertas descartadas: { key → timestamp (ms) } — reaparecen tras 7 días
  dismissedAlerts: {},

  // Mes (YYYY-MM) del último resumen mensual mostrado — evita mostrarlo dos veces
  lastRecapShown: null,

  // Mes (YYYY-MM) del último informe ejecutivo mensual descargado
  lastMonthlyBriefing: null,

  // Anotaciones manuales del Timeline financiero: [{ id, date, text, emoji }]
  timelineAnnotations: [],

  // Alertas personalizadas creadas por el usuario: [{ id, type, params, label, icon, severity, active, createdAt }]
  customAlerts: [],

  // Visibilidad de widgets por sección: { 'section-id': { 'widget-id': false, ... } }
  layoutConfig: {},

  // Configuración de alertas inteligentes
  smartAlertsConfig: {
    concentrationPct: 30,
    savingsDropPct:   30,
  },

  // Filtro de mes activo en la vista de transacciones (persiste entre navegaciónes)
  txFilterMonth: '',

  // Transacciones recurrentes: { id, description, category, type, amount, frequency, nextDate, active }
  recurring: [],

  // Clasificación 50/30/20: categoryName → 'needs' | 'wants' | 'skip' (vacío = usa DEFAULT_BUDGET_TYPE)
  categoryBudgetType: {},

  // Hitos de patrimonio alcanzados: [1000, 10000, ...]
  achievedMilestones: [],

  // Hitos de comportamiento desbloqueados: ['first_tx', 'save_20', ...]
  achievedBehaviorMilestones: [],

  // URL del webhook para exportación (vacío = desactivado)
  webhookUrl: '',

  // Conexiones bancarias PSD2: [{ id, bankCode, bankName, bankLogo, accounts[], lastImport }]
  bankConnections: [],

  // ID anónimo de cliente — generado una vez, nunca cambia — usado para métricas de retención
  clientId: '',

  // Autenticación Firebase (no se persiste en localStorage)
  uid:       null,
  userEmail: null,
  userPhoto: null,
  isAdmin:   false,
  devMode:   false,
};

/* ═══════════════════════════════════════════════════════════════
   STORE — gestor de estado centralizado (no-breaking)
   APP sigue siendo accesible directamente para compatibilidad.
   Store.subscribe() permite reaccionar a cambios de estado.
═══════════════════════════════════════════════════════════════ */
const Store = (() => {
  const _subs = [];

  return {
    get(key) {
      return key === undefined ? APP : APP[key];
    },

    set(key, value) {
      APP[key] = value;
      _subs.forEach(fn => { try { fn(key, value); } catch (e) {} });
      saveData();
    },

    update(key, updater) {
      const next = updater(APP[key]);
      APP[key] = next;
      _subs.forEach(fn => { try { fn(key, next); } catch (e) {} });
      saveData();
    },

    subscribe(fn) {
      _subs.push(fn);
      return () => {
        const i = _subs.indexOf(fn);
        if (i !== -1) _subs.splice(i, 1);
      };
    },
  };
})();

const DEFAULT_BUDGET_TYPE = {
  'Alimentación':'needs','Supermercado':'needs','Vivienda':'needs','Alquiler':'needs',
  'Hipoteca':'needs','Transporte':'needs','Gasolina':'needs','Salud':'needs','Médico':'needs',
  'Farmacia':'needs','Seguros':'needs','Educación':'needs','Suministros':'needs',
  'Agua':'needs','Luz':'needs','Gas':'needs','Internet':'needs','Teléfono':'needs',
  'Restaurantes':'wants','Ocio':'wants','Ropa':'wants','Viajes':'wants',
  'Entretenimiento':'wants','Suscripciones':'wants','Tecnología':'wants',
  'Libros':'wants','Deporte':'wants','Cuidado personal':'wants',
  'Regalos':'wants','Mascotas':'wants','Compras':'wants','Fiesta':'wants','Amigos':'wants',
};

function getCategoryBudgetType(category) {
  return APP.categoryBudgetType[category] || DEFAULT_BUDGET_TYPE[category] || 'wants';
}
