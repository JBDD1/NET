# Convención de commits — Finova

## Formato

```
tipo: descripción corta en minúsculas
```

- Máximo ~72 caracteres en la primera línea
- Sin punto final
- En español

## Tipos

| Prefijo      | Cuándo usarlo |
|--------------|---------------|
| `feat:`      | Nueva funcionalidad visible para el usuario |
| `fix:`       | Corrección de un bug |
| `security:`  | Mejora de seguridad, parche de vulnerabilidad |
| `style:`     | Cambios de CSS/diseño sin lógica |
| `refactor:`  | Reorganización de código sin cambiar funcionalidad |
| `perf:`      | Mejora de rendimiento |
| `docs:`      | Solo documentación |
| `chore:`     | Tareas de mantenimiento (npm install, configs, etc.) |
| `release:`   | Versión nueva / merge a producción |

## Ejemplos

```
feat: añadir calculadora FIRE en dashboard
fix: corregir compensación IRPF límite 25%
security: implementar RLS con Firebase Admin
security: añadir CSP y security headers A+
style: actualizar tema obsidian-brass en móvil
refactor: separar lógica de cartera en portfolio.js
perf: lazy load de fiscal.js y simulator.js
chore: actualizar dependencias npm
chore: añadir terser para minificación en build
release: v1.2.0 — lanzamiento público
```

## Flujo de ramas

```
main        ← producción (Vercel + Railway)
develop     ← desarrollo activo
feature/*   ← una rama por feature nueva
hotfix/*    ← arreglos urgentes en producción
```

### Rama nueva para una feature

```bash
git checkout develop
git checkout -b feature/nombre-feature
# ... trabajar ...
git add .
git commit -m "feat: descripción"
git push origin feature/nombre-feature
# Abrir Pull Request → develop
```

### Hotfix urgente en producción

```bash
git checkout main
git checkout -b hotfix/descripcion
# ... arreglar ...
git commit -m "fix: descripción del arreglo"
git checkout main && git merge hotfix/descripcion --no-ff
git push origin main
git checkout develop && git merge hotfix/descripcion
git branch -d hotfix/descripcion
```
