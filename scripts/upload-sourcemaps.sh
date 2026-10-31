#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Finova — subir source maps a Sentry y BORRARLOS de dist/
#
# OPCIONAL. Sin esto la app se despliega igual; lo único que se pierde es el
# número de línea exacto en las trazas de Sentry (los nombres de función SÍ se
# conservan, porque este proyecto no renombra funciones globales).
#
# Uso:
#   SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=... ./scripts/upload-sourcemaps.sh
#
# El token NUNCA va en el repositorio: se pasa por variable de entorno, en
# local o en las variables del proyecto de Vercel.
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

: "${SENTRY_AUTH_TOKEN:?Falta SENTRY_AUTH_TOKEN}"
: "${SENTRY_ORG:?Falta SENTRY_ORG}"
: "${SENTRY_PROJECT:?Falta SENTRY_PROJECT}"

RELEASE="${SENTRY_RELEASE:-$(git rev-parse --short HEAD 2>/dev/null || echo 'sin-release')}"

echo "▸ Construyendo CON source maps (release: $RELEASE)…"
VITE_SOURCEMAP=1 VITE_RELEASE="$RELEASE" npm run build

echo "▸ Subiendo source maps a Sentry…"
npx --yes @sentry/cli sourcemaps inject ./dist
npx --yes @sentry/cli sourcemaps upload --release "$RELEASE" ./dist

# ── Lo más importante de este script ──
# Si los .map se quedan en dist/, cualquiera puede descargar el código fuente
# original desde el navegador. Se borran SIEMPRE, incluso si la subida falló.
echo "▸ Borrando los source maps de dist/…"
find ./dist -name "*.map" -type f -delete

# Y las referencias al final de cada fichero, que si no apuntan a un 404.
find ./dist -name "*.js" -type f -exec sed -i'' -e '/^\/\/# sourceMappingURL=/d' {} \; 2>/dev/null || true

RESTANTES=$(find ./dist -name "*.map" -type f | wc -l | tr -d ' ')
if [ "$RESTANTES" != "0" ]; then
  echo "✗ ABORTA: quedan $RESTANTES source maps en dist/. NO despliegues." >&2
  exit 1
fi

echo "✓ Source maps subidos y borrados de dist/. Listo para desplegar."
