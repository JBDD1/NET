#!/bin/bash
# scripts/release.sh
# Uso: bash scripts/release.sh "descripción del cambio"
#
# Flujo:
#   develop → commit + push
#   Si estás en develop, pregunta si mergear a main (producción)

set -e

MSG=${1:-"chore: update"}
BRANCH=$(git branch --show-current)

echo ""
echo "🔍 Rama actual: $BRANCH"
echo "📝 Mensaje:     $MSG"
echo ""

# ── Commit si hay cambios pendientes ──────────────────────────
if ! git diff-index --quiet HEAD --; then
  echo "📂 Añadiendo cambios..."
  git add .
  git commit -m "$MSG"
  echo "✅ Commit creado"
else
  echo "ℹ️  Sin cambios pendientes — solo haciendo push"
fi

# ── Push a la rama actual ──────────────────────────────────────
git push origin "$BRANCH"
echo "✅ Push completado → origin/$BRANCH"

# ── Merge a main si estamos en develop ────────────────────────
if [ "$BRANCH" = "develop" ]; then
  echo ""
  read -p "¿Mergear develop → main (producción)? [s/N] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Ss]$ ]]; then
    git checkout main
    git pull origin main  # asegurar que main está al día
    git merge develop --no-ff -m "release: merge develop → main"
    git push origin main
    git checkout develop
    echo ""
    echo "🚀 Desplegado a producción (main)"
    echo "   Vercel y Railway detectarán el push automáticamente."
  else
    echo "ℹ️  Merge cancelado. develop sigue siendo la rama activa."
  fi
fi

echo ""
