/**
 * Finova — dashboard-layout.test.js
 * Tests del sistema de dashboard personalizable: catálogo de widgets,
 * fusión de preferencias guardadas (getEffectiveDashLayout), migración del
 * personalizador genérico antiguo, y el cálculo puro de reordenamiento usado
 * tanto por el arrastre con puntero como por los botones ↑/↓.
 *
 * Carga el código REAL de src/sections/dashboard.js (vm), igual que
 * categorization.test.js hace con script.js, para que estos tests no puedan
 * divergir en silencio del comportamiento real. Solo se ejercitan las
 * funciones puras de datos — el arrastre/resize sobre el DOM real requiere
 * verificación manual en dispositivo (documentado en el informe final).
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/sections/dashboard.js'), 'utf8');

let APP, fns, DASH_BLOCK_DEFS, DASH_KPI_DEFS;

function loadScript() {
  APP = { dashboardLayout: null, dashboardKpis: null, layoutConfig: {} };
  const context = vm.createContext(Object.assign({}, global, { APP }));
  vm.runInContext(SRC, context, { filename: 'dashboard.js' });

  fns = vm.runInContext(
    '({getEffectiveDashLayout,_dashDefaultLayout,_dashMigrateLegacyLayoutConfig,_dashComputeReorder})',
    context
  );
  DASH_BLOCK_DEFS = vm.runInContext('DASH_BLOCK_DEFS', context);
  DASH_KPI_DEFS   = vm.runInContext('DASH_KPI_DEFS', context);
  APP = vm.runInContext('APP', context);
  return context;
}

beforeEach(() => { loadScript(); });

describe('Catálogo de widgets (DASH_BLOCK_DEFS) — nunca inventa', () => {
  test('ningún widget de Viajes — la funcionalidad no existe en la app', () => {
    const names = DASH_BLOCK_DEFS.map(d => d.id + ' ' + d.label).join(' ').toLowerCase();
    expect(names).not.toMatch(/viaje/);
  });

  test('todos los ids son únicos', () => {
    const ids = DASH_BLOCK_DEFS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('cada widget pertenece a una de las 4 categorías del catálogo', () => {
    const valid = ['resumen', 'inversiones', 'organizacion', 'otros'];
    DASH_BLOCK_DEFS.forEach(d => expect(valid).toContain(d.category));
  });

  test('el tamaño por defecto de cada widget está entre sus tamaños permitidos (nunca un tamaño incompatible)', () => {
    DASH_BLOCK_DEFS.forEach(d => {
      expect(d.sizes).toContain(d.defaultSize);
      expect(d.sizes.length).toBeGreaterThan(0);
    });
  });

  test('los KPIs, el timeline y el heatmap solo admiten ancho completo (necesitan todo el ancho para ser legibles)', () => {
    ['dash-block-kpis', 'dash-block-timeline', 'dash-block-heatmap'].forEach(id => {
      const def = DASH_BLOCK_DEFS.find(d => d.id === id);
      expect(def.sizes).toEqual(['full']);
    });
  });
});

describe('getEffectiveDashLayout — fusión de preferencias', () => {
  test('sin preferencias guardadas (null) devuelve el layout por defecto completo, todo visible', () => {
    const layout = fns.getEffectiveDashLayout();
    expect(layout.length).toBe(DASH_BLOCK_DEFS.length);
    expect(layout.every(b => b.visible === true)).toBe(true);
    layout.forEach(b => {
      const def = DASH_BLOCK_DEFS.find(d => d.id === b.id);
      expect(b.size).toBe(def.defaultSize);
    });
  });

  test('preferencia guardada antigua sin campo "size" (pre-resize) cae al tamaño por defecto, no rompe', () => {
    APP.dashboardLayout = [{ id: 'dash-block-kpis', visible: true }, { id: 'dash-block-goals', visible: false }];
    const layout = fns.getEffectiveDashLayout();
    const goals = layout.find(b => b.id === 'dash-block-goals');
    expect(goals.visible).toBe(false);
    expect(goals.size).toBe('medium');
  });

  test('un tamaño inválido para ese widget cae al tamaño por defecto en vez de aplicarse', () => {
    APP.dashboardLayout = [{ id: 'dash-block-kpis', visible: true, size: 'small' }]; // kpis solo admite 'full'
    const layout = fns.getEffectiveDashLayout();
    expect(layout.find(b => b.id === 'dash-block-kpis').size).toBe('full');
  });

  test('un widget nuevo introducido en una versión posterior aparece automáticamente, visible, sin migración manual', () => {
    // Simula una preferencia guardada ANTES de que existieran los widgets nuevos
    APP.dashboardLayout = [{ id: 'dash-block-kpis', visible: true, size: 'full' }];
    const layout = fns.getEffectiveDashLayout();
    const div = layout.find(b => b.id === 'dash-block-dividends');
    expect(div).toBeDefined();
    expect(div.visible).toBe(true);
  });

  test('entradas corruptas (sin id, o de un widget que ya no existe) se ignoran sin lanzar error', () => {
    APP.dashboardLayout = [null, { foo: 'bar' }, { id: 'dash-block-ghost-widget', visible: true }, { id: 'dash-block-goals', visible: true, size: 'medium' }];
    expect(() => fns.getEffectiveDashLayout()).not.toThrow();
    const layout = fns.getEffectiveDashLayout();
    expect(layout.find(b => b.id === 'dash-block-ghost-widget')).toBeUndefined();
    expect(layout.find(b => b.id === 'dash-block-goals').visible).toBe(true);
  });

  test('ids duplicados en el guardado: solo se conserva la primera aparición', () => {
    APP.dashboardLayout = [
      { id: 'dash-block-goals', visible: false, size: 'small' },
      { id: 'dash-block-goals', visible: true,  size: 'large' },
    ];
    const layout = fns.getEffectiveDashLayout();
    const occurrences = layout.filter(b => b.id === 'dash-block-goals');
    expect(occurrences.length).toBe(1);
    expect(occurrences[0].visible).toBe(false);
  });
});

describe('_dashMigrateLegacyLayoutConfig — compatibilidad con el personalizador antiguo', () => {
  test('traslada widgets ocultos desde layoutConfig["section-dashboard"] si nunca se usó el editor nuevo', () => {
    APP.layoutConfig = { 'section-dashboard': { 'dash-block-heatmap': false, 'dash-block-timeline': false } };
    APP.dashboardLayout = null;
    const migrated = fns._dashMigrateLegacyLayoutConfig();
    expect(migrated).toBe(true);
    expect(APP.dashboardLayout).not.toBeNull();
    expect(APP.dashboardLayout.find(b => b.id === 'dash-block-heatmap').visible).toBe(false);
    expect(APP.dashboardLayout.find(b => b.id === 'dash-block-kpis').visible).toBe(true);
    expect(APP.layoutConfig['section-dashboard']).toBeUndefined();
  });

  test('no hace nada si ya existe un dashboardLayout real (nunca sobrescribe una personalización ya guardada)', () => {
    APP.layoutConfig = { 'section-dashboard': { 'dash-block-heatmap': false } };
    APP.dashboardLayout = [{ id: 'dash-block-kpis', visible: true, size: 'full' }];
    const migrated = fns._dashMigrateLegacyLayoutConfig();
    expect(migrated).toBe(false);
    expect(APP.dashboardLayout.length).toBe(1); // intacto
  });

  test('no hace nada si no existe preferencia antigua', () => {
    APP.layoutConfig = {};
    APP.dashboardLayout = null;
    expect(fns._dashMigrateLegacyLayoutConfig()).toBe(false);
    expect(APP.dashboardLayout).toBeNull();
  });
});

describe('_dashComputeReorder — función pura usada por arrastre y botones ↑/↓', () => {
  test('mueve un elemento antes de otro', () => {
    const r = fns._dashComputeReorder(['a', 'b', 'c', 'd'], 'd', 'b', true);
    expect(r).toEqual(['a', 'd', 'b', 'c']);
  });

  test('mueve un elemento después de otro', () => {
    const r = fns._dashComputeReorder(['a', 'b', 'c', 'd'], 'a', 'c', false);
    expect(r).toEqual(['b', 'c', 'a', 'd']);
  });

  test('no cambia nada si el origen y el destino son el mismo', () => {
    const r = fns._dashComputeReorder(['a', 'b', 'c'], 'b', 'b', true);
    expect(r).toEqual(['a', 'b', 'c']);
  });

  test('no revienta ni pierde elementos si el destino no existe en la lista', () => {
    const ids = ['a', 'b', 'c'];
    const r = fns._dashComputeReorder(ids, 'a', 'zzz', true);
    expect(r.sort()).toEqual(['a', 'b', 'c']);
  });

  test('nunca pierde ni duplica elementos tras reordenar', () => {
    const ids = DASH_BLOCK_DEFS.map(d => d.id);
    const r = fns._dashComputeReorder(ids, ids[ids.length - 1], ids[0], true);
    expect(r.length).toBe(ids.length);
    expect(new Set(r).size).toBe(ids.length);
  });
});

describe('_dashDefaultLayout — distribución predeterminada', () => {
  test('incluye todos los widgets del catálogo, todos visibles, con su tamaño por defecto', () => {
    const layout = fns._dashDefaultLayout();
    expect(layout.length).toBe(DASH_BLOCK_DEFS.length);
    expect(layout.every(b => b.visible === true)).toBe(true);
  });
});
