# Seguridad — Finova

## Dónde viven los secretos

| Secreto | Dónde está | Quién puede verlo |
|---|---|---|
| Firebase API Key (cliente) | `.env.development`, `.env.production` | Cualquiera — es pública por diseño de Google |
| Firebase Admin Private Key | Railway → Variables | Solo Railway y tú |
| FINOVA_GROQ_KEY | Railway → Variables | Solo Railway y tú |
| FINOVA_CLAUDE_KEY | Railway → Variables | Solo Railway y tú |
| FINOVA_ADMIN_EMAILS | Railway → Variables | Solo Railway y tú |
| Claves IA del usuario | `localStorage` del usuario | Solo el propio usuario |

## Reglas de oro

1. **Nunca** poner secretos reales en el código fuente
2. **Nunca** poner secretos en archivos que van a GitHub (`.env`, `.env.local`, etc.)
3. **Nunca** loguear secretos en consola o en logs
4. **Nunca** enviar secretos en URLs (query params visibles en logs de acceso)
5. **Siempre** usar HTTPS para transmitir cualquier dato sensible
6. **Siempre** rotar una clave si hay la mínima duda de que estuvo expuesta

## Archivos comprometidos con git

| Archivo | ¿Va a GitHub? | Motivo |
|---|---|---|
| `.env.development` | ✅ Sí | Solo Firebase client keys (públicas) |
| `.env.production` | ✅ Sí | Solo Firebase client keys (públicas) |
| `.env.server.example` | ✅ Sí | Plantilla sin valores reales |
| `.env.local` | ❌ NO | Secretos locales del desarrollador |
| `firebase-service-account.json` | ❌ NO | Credencial privada de Firebase Admin |

## ¿Por qué las Firebase client keys son seguras en el código?

Firebase Client API Key no es un secreto tradicional. Google lo diseñó para ser público:
- Solo identifica el proyecto Firebase, no autentica operaciones
- Las operaciones están protegidas por Firebase Security Rules y Firebase Auth
- La documentación oficial de Google documenta este comportamiento
- **Lo que SÍ sería peligroso**: la Firebase Admin Private Key (nunca en frontend)

## Si subes un secreto a GitHub por error

1. **Inmediatamente** revoca la clave en la plataforma:
   - Groq: `console.groq.com` → API Keys → Delete
   - Claude: `console.anthropic.com` → API Keys → Delete
   - Firebase Admin: Firebase Console → Service Accounts → Delete key
   - GoCardless: `bankaccountdata.gocardless.com` → Secrets → Revoke

2. Elimina el secreto del historial de Git:
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch ARCHIVO_CON_SECRETO" \
     --prune-empty --tag-name-filter cat -- --all
   git push origin --force --all
   ```

3. Genera una nueva clave y configúrala en Railway

4. Revisa los logs de Railway para detectar uso no autorizado

## Variables de entorno por plataforma

### Railway (servidor)

Panel: `railway.app` → tu proyecto → Variables

Variables requeridas en producción:
- `FINOVA_GROQ_KEY` o `FINOVA_CLAUDE_KEY`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- `ALLOWED_ORIGIN` (tu dominio de Vercel)
- `FINOVA_FIREBASE_PROJECT` (ID del proyecto Firebase)
- `FINOVA_ADMIN_EMAILS`

### Vercel (frontend)

Panel: `vercel.com` → tu proyecto → Settings → Environment Variables

Variables requeridas:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_SERVER_URL` (dejar vacío — Vercel hace el proxy automáticamente)

### Desarrollo local

1. Crea `.env.local` (está en `.gitignore`)
2. Rellena los valores reales copiando la estructura de `.env.server.example`
3. Verifica que `.env.local` NO aparece en `git status`

## Verificaciones rápidas

```bash
# Secretos NO están en git
git ls-files .env.local firebase-service-account.json
# Resultado esperado: sin output

# Sin API keys hardcodeadas en el código
grep -rn "sk-ant-\|gsk_\|AIzaSy\|-----BEGIN PRIVATE" src/ --include="*.js"
# Resultado esperado: sin output

# Sin URL de Railway en el frontend
grep -rn "railway.app" src/ dist/ 2>/dev/null
# Resultado esperado: sin output
```
