# Guía de despliegue en producción — SeñasConecta

Sigue estos pasos en orden para publicar **SeñasConecta** en **GitHub Pages**, **Cloudflare Workers** y **Cloudflare D1**, con autenticación real mediante **GitHub OAuth** restringida a un único administrador.

> **Importante:** No existen credenciales ni identificadores preconfigurados. Debes crear tu propia base D1, tu propia GitHub OAuth App y cargar tus propios secretos en Cloudflare.

---

## Paso 1: Crear el repositorio en GitHub

1. Crea un repositorio en GitHub (puede ser **privado** si cuentas con GitHub Pro/Team para Pages, o **público** teniendo presente que el repositorio contiene **únicamente código fuente sin datos personales ni secretos**).
2. Verifica antes de subir que `.gitignore` excluya `.dev.vars`, archivos `.db`/`.sqlite` y cualquier respaldo exportado.
3. Sube el proyecto a la rama `main`:

```bash
git init
git add .
git commit -m "Versión inicial de SeñasConecta"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/senasconecta.git
git push -u origin main
```

---

## Paso 2: Elegir la estrategia de dominios (Muy importante para cookies y CORS)

Antes de registrar las URLs definitivas, decide cómo publicarás frontend y API:

### Opción A (Recomendada): Dominio personalizado bajo el mismo sitio registrable

Por ejemplo:
- Frontend (GitHub Pages): `https://senasconecta.tudominio.cl` (o `https://tudominio.cl`)
- Backend (Cloudflare Worker Custom Domain / Route): `https://api.senasconecta.tudominio.cl` (o `https://tudominio.cl/api/*`)

Ventajas reales:
- Las cookies de sesión usan `SameSite=Lax; Secure; HttpOnly` (con `COOKIE_DOMAIN = ".senasconecta.tudominio.cl"` si son subdominios, o sin `COOKIE_DOMAIN` si comparten exactamente el mismo origen mediante ruta `/api/*`).
- Se comportan como **cookies de primera parte (first-party)**.
- Funcionan de manera confiable en Chrome, Firefox, Safari (iOS/macOS con ITP) y navegadores móviles sin restricciones de cookies de terceros.

### Opción B: Dominios predeterminados (`*.github.io` + `*.workers.dev`)

Por ejemplo:
- Frontend: `https://tu-usuario.github.io/senasconecta`
- Backend: `https://senasconecta-api.tu-subdominio.workers.dev`

Implicaciones técnicas reales en navegadores modernos:
- `github.io` y `workers.dev` están en la *Public Suffix List* como sitios registrables distintos (**cross-site**).
- El Worker detecta automáticamente este escenario (`COOKIE_SAMESITE = "auto"`) y emite cookies con `SameSite=None; Secure; HttpOnly`.
- Sin embargo, navegadores con bloqueo estricto de cookies de terceros (Safari con *Prevent Cross-Site Tracking*, Firefox *Total Cookie Protection* en modo estricto, o Chrome en modo incógnito / bloqueo de terceros) **pueden bloquear el envío de la cookie hacia `workers.dev`**.
- SeñasConecta **nunca** guarda tokens en `localStorage` como alternativa insegura; si el navegador bloquea la cookie entre sitios, mostrará un aviso claro indicando que debes permitir cookies para el dominio de la API o migrar a la Opción A.

---

## Paso 3: Crear la base de datos Cloudflare D1

1. Inicia sesión en Cloudflare con Wrangler:

```bash
cd worker
npm install
npx wrangler login
```

2. Crea la base de datos D1:

```bash
npx wrangler d1 create senasconecta-db
```

3. Copia el `database_id` (UUID) que devuelve Wrangler y reemplaza `REEMPLAZAR_CON_TU_DATABASE_ID` dentro de `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "senasconecta-db"
database_id = "TU-UUID-REAL-DE-D1"
migrations_dir = "migrations"
```

---

## Paso 4: Aplicar las migraciones SQL en D1

Ejecuta las migraciones sobre la base remota en Cloudflare:

```bash
npx wrangler d1 migrations apply senasconecta-db --remote
```

Esto crea las tablas normalizadas (`localidades`, `congregaciones`, `congregacion_localidades`, `personas`, `seguimientos`, `configuracion_categorias`, `sesiones`, `oauth_states`, `rate_limits`), índices y las categorías iniciales junto con las localidades sugeridas de referencia (sin personas ficticias).

---

## Paso 5: Configurar variables de dominio y CORS en `worker/wrangler.toml`

Edita la sección `[vars]` de `worker/wrangler.toml`:

- Si usas **Opción A (mismo dominio registrable)**:
  ```toml
  [vars]
  FRONTEND_URL = "https://senasconecta.tudominio.cl"
  ALLOWED_ORIGINS = "https://senasconecta.tudominio.cl"
  SESSION_TTL_HOURS = "12"
  COOKIE_SAMESITE = "lax"
  COOKIE_DOMAIN = ".tudominio.cl" # O vacío "" si Worker atiende en https://senasconecta.tudominio.cl/api/*
  ```
- Si usas **Opción B (`github.io` + `workers.dev`)**:
  ```toml
  [vars]
  FRONTEND_URL = "https://TU-USUARIO.github.io/senasconecta/"
  ALLOWED_ORIGINS = "https://TU-USUARIO.github.io"
  SESSION_TTL_HOURS = "12"
  COOKIE_SAMESITE = "auto"
  COOKIE_DOMAIN = ""
  ```

---

## Paso 6: Desplegar el Cloudflare Worker

Desde `worker/`:

```bash
npx wrangler deploy
```

> **Alternativa sin instalar Node.js ni Wrangler localmente:** si ya creaste la base D1 (`database_id` en `worker/wrangler.toml`) y guardaste los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en **GitHub → Settings → Secrets and variables → Actions → Secrets**, puedes ejecutar manualmente el workflow `.github/workflows/deploy-worker.yml` (*Desplegar Worker y D1 en Cloudflare*) desde la pestaña **Actions** de GitHub.

Anota la URL resultante del Worker (por ejemplo `https://senasconecta-api.tu-subdominio.workers.dev` o tu dominio personalizado).

Verifica que el servicio responde en modo básico:

```bash
curl https://TU-WORKER-URL/api/health
# Debe responder: {"ok":true,"service":"senasconecta-api"}
```

---

## Paso 7: Obtener tu `ADMIN_GITHUB_ID` numérico

El control de acceso compara el **ID numérico inmutable** de tu cuenta de GitHub (no el nombre de usuario, ya que el `login` puede cambiar).

Consulta tu ID numérico público mediante la API oficial de GitHub:

```bash
curl -s https://api.github.com/users/TU_USUARIO_GITHUB | grep '"id":'
```

O abre en el navegador `https://api.github.com/users/TU_USUARIO_GITHUB` y anota el número entero del campo `"id"`.

---

## Paso 8: Registrar la GitHub OAuth App

1. Ve a **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Completa los campos:
   - **Application name:** `SeñasConecta`
   - **Homepage URL:** la URL exacta de tu frontend (ej. `https://TU-USUARIO.github.io/senasconecta` o `https://senasconecta.tudominio.cl`)
   - **Authorization callback URL:** la URL exacta del callback en tu Worker:
     - `https://TU-WORKER-URL/auth/callback`
     - *(Si montaste el Worker bajo la ruta `/api/*` del mismo dominio, usa `https://senasconecta.tudominio.cl/api/auth/callback`)*
3. Guarda la aplicación, copia el **Client ID** y genera un **Client Secret**.

---

## Paso 9: Cargar los secretos en Cloudflare (nunca en Git)

Desde `worker/`, configura cada secreto en Cloudflare:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ADMIN_GITHUB_ID
npx wrangler secret put SESSION_PEPPER
```

Para `SESSION_PEPPER`, genera una cadena aleatoria larga (por ejemplo con `openssl rand -hex 32`).

---

## Paso 10: Conectar el frontend con el backend

Puedes hacerlo de cualquiera de estas dos formas (el frontend prioriza GitHub Pages en producción sin perder compatibilidad automática en pruebas locales):

1. **Opción directa en código:** edita `frontend/js/config.js` y establece `API_BASE_URL` con la URL pública de tu Worker (sin barra final `/`):

```js
export const CONFIG = {
  API_BASE_URL: 'https://TU-WORKER-URL',
};
```

*(Si usas un proxy bajo el mismo origen `/api/*`, deja `API_BASE_URL: ''`).* Haz commit y push de `frontend/js/config.js`.

2. **Opción mediante Variable de GitHub Actions:** en tu repositorio ve a **Settings → Secrets and variables → Actions → Variables** y crea la variable `SENASCONECTA_API_URL` con el valor `https://TU-WORKER-URL`. El workflow `.github/workflows/deploy-pages.yml` la inyectará automáticamente al empaquetar GitHub Pages.

---

## Paso 11: Publicar el frontend en GitHub Pages

El repositorio incluye el flujo `.github/workflows/deploy-pages.yml` (y `frontend/.nojekyll`).

1. En tu repositorio de GitHub ve a **Settings → Pages**.
2. En **Build and deployment → Source**, selecciona **GitHub Actions**.
3. Ejecuta manualmente el workflow *Desplegar Frontend en GitHub Pages* (o haz un push en `frontend/`).
4. Si utilizas dominio personalizado (Opción A), configúralo también en **Custom domain** dentro de Settings → Pages y habilita **Enforce HTTPS**.

---

## Paso 12: Probar el inicio de sesión real en navegador

1. Abre la URL de tu frontend en un navegador real (escritorio y teléfono móvil) y confirma que puedes consultar los módulos en **Modo lectura**.
2. Abre las Herramientas de Desarrollador (Consola y Red) y verifica que no haya errores.
3. Haz clic en **«Ingresar con GitHub»** (en la barra lateral o superior).
4. Autoriza la aplicación en GitHub (observa que solo solicita permiso de lectura de perfil `read:user`, nunca escritura en repositorios).
5. Confirma que regresas a SeñasConecta con permisos de administración (botones para agregar/editar, usuario en la barra lateral) y que al **recargar la página (F5)** la sesión sigue activa.
6. Prueba crear una localidad o persona de prueba, verifica que persiste al recargar, luego elimínala si era de prueba y verifica **«Cerrar sesión»** (el sitio vuelve a modo solo lectura).

---

## Paso 13: Comprobar que otras cuentas de GitHub son rechazadas

1. Abre una ventana de incógnito o utiliza una **segunda cuenta de GitHub distinta** a la definida en `ADMIN_GITHUB_ID`.
2. Intenta iniciar sesión desde **«Ingresar con GitHub»**.
3. Confirma que:
   - GitHub redirige al callback del Worker.
   - El Worker compara el ID, **deniega el acceso** y no crea ninguna fila en la tabla `sesiones` de D1.
   - SeñasConecta redirige a modo lectura mostrando el aviso: *«Acceso denegado: la cuenta de GitHub autenticada no corresponde al administrador autorizado de SeñasConecta.»*
   - Cualquier mutación (`POST`, `PUT`, `PATCH`, `DELETE`, por ejemplo `POST https://TU-WORKER-URL/api/personas`) o descarga de respaldo (`GET https://TU-WORKER-URL/api/respaldos/exportar?formato=json`) sin cookie válida de administrador devuelve `401 Unauthorized`.

