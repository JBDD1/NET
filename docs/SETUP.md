# Configuración de GitHub — Finova (JBDD1/NET)

## 1. Proteger la rama main

Impide commits directos a producción — todo pasa por Pull Request desde develop.

1. GitHub → **JBDD1/NET** → **Settings** → **Branches**
2. **Add branch protection rule** → Branch name pattern: `main`
3. Activar estas opciones:
   - ✅ **Require a pull request before merging**
     - Require approvals: 1 (opcional si trabajas solo)
   - ✅ **Require status checks to pass before merging**
     - Buscar y seleccionar el check: `check` (del workflow CI — Finova)
   - ✅ **Require branches to be up to date before merging**
   - ✅ **Do not allow bypassing the above settings**
4. **Save changes**

Con esto, `git push origin main` devolverá error. Solo los merges via PR llegan a producción.

---

## 2. Variables de entorno en Vercel

En **Vercel → tu proyecto → Settings → Environment Variables**, añade:

| Variable | Entorno | Valor |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | Production + Preview | `AIzaSyBw0RiwDM-vcqJ_mXDZGz1xXy-rF6JjBqw` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Production + Preview | `finova-92100.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Production + Preview | `finova-92100` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Production + Preview | `finova-92100.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Production + Preview | `387946044101` |
| `VITE_FIREBASE_APP_ID` | Production + Preview | `1:387946044101:web:9d6435d177a4b7ad92eeac` |
| `VITE_SERVER_URL` | Production | *(vacío)* |
| `VITE_APP_ENV` | Production | `production` |

---

## 3. Variables de entorno en Railway

En **Railway → tu servicio → Variables**, añade:

| Variable | Descripción |
|---|---|
| `FIREBASE_PROJECT_ID` | `finova-92100` |
| `FIREBASE_CLIENT_EMAIL` | De Firebase Console → Service Accounts → Generate key |
| `FIREBASE_PRIVATE_KEY` | Campo `"private_key"` del JSON descargado (completo con `-----BEGIN...`) |
| `ALLOWED_ORIGIN` | URL de tu deploy en Vercel (ej: `https://net.vercel.app`) |
| `FINOVA_FIREBASE_PROJECT` | `finova-92100` |
| `FINOVA_ADMIN_EMAILS` | `MyFinova1@gmail.com` |

**Cómo obtener las credenciales de Firebase Admin:**
1. [console.firebase.google.com](https://console.firebase.google.com) → proyecto finova-92100
2. ⚙ → **Project Settings** → **Service accounts**
3. **Generate new private key** → descarga el JSON
4. Copia `client_email` → `FIREBASE_CLIENT_EMAIL`
5. Copia `private_key` → `FIREBASE_PRIVATE_KEY`

---

## 4. Deploy automático

- **Vercel**: detecta cada push a `main` y redespliega automáticamente
- **Railway**: detecta cada push a `main` y reinicia el servidor automáticamente

Para desplegar, mergear `develop` → `main`:
```bash
bash scripts/release.sh "feat: descripción"
# cuando pregunte, confirmar merge a main
```
