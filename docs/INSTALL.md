# Guía de instalación y desarrollo local — SeñasConecta

Esta guía detalla cómo preparar el proyecto localmente, inicializar la base de datos y ejecutar pruebas.

## 1. Requisitos recomendados para desarrollo y despliegue en Cloudflare

Para desplegar hacia Cloudflare Workers y D1 necesitarás en tu equipo:

- **Git**
- **Node.js** (v20 LTS o superior) y **npm**
- **Wrangler CLI** (`npm install -D wrangler` dentro de `worker/`, o `npx wrangler`)
- Una cuenta gratuita o de pago en **Cloudflare**
- Una cuenta de **GitHub** (será el único administrador autorizado)

> **Uso rápido en local sin Node.js ni Wrangler:** Puedes ejecutar todo el proyecto localmente (frontend, Worker real `worker/src/index.js`, base SQLite persistente en `.local/senasconecta.sqlite` y simulador OAuth) con un solo comando:
>
> ```bash
> python3 scripts/dev_local.py
> ```
>
> Luego abre `http://127.0.0.1:8080/` (o si usas Live Server en `http://127.0.0.1:5500/frontend/index.html`, se conectará automáticamente al Worker local en `:8787` mientras `dev_local.py` esté en ejecución).

---

## 2. Configuración local con Wrangler (Cloudflare D1 local)

1. Instala las herramientas de desarrollo del Worker:

```bash
cd worker
npm install
```

2. Crea el archivo local de secretos (ignorado por Git):

```bash
cp .dev.vars.example .dev.vars
```

Edita `worker/.dev.vars` con valores reales de una **GitHub OAuth App de desarrollo** (callback apuntando a `http://127.0.0.1:8787/auth/callback`):

```ini
GITHUB_CLIENT_ID=tu_client_id_de_desarrollo
GITHUB_CLIENT_SECRET=tu_client_secret_de_desarrollo
ADMIN_GITHUB_ID=tu_id_numerico_de_github
SESSION_PEPPER=genera_una_cadena_aleatoria_larga
```

3. En `worker/wrangler.toml`, asegúrate de ajustar temporalmente para desarrollo local (o mediante `--var` al ejecutar `wrangler dev`):

- `FRONTEND_URL = "http://127.0.0.1:8080"`
- `ALLOWED_ORIGINS = "http://127.0.0.1:8080"`

4. Aplica las migraciones en la base D1 local de Wrangler:

```bash
npx wrangler d1 migrations apply senasconecta-db --local
```

5. Inicia el Worker local:

```bash
npx wrangler dev --port 8787
```

6. En otra terminal, configura temporalmente `API_BASE_URL` en `frontend/js/config.js` a `'http://127.0.0.1:8787'` y sirve el frontend estático:

```bash
cd frontend
python3 -m http.server 8080 --bind 127.0.0.1
```

7. Abre `http://127.0.0.1:8080` en tu navegador.

---

## 3. Ejecución de la suite de pruebas automatizadas locales

Si deseas ejecutar las pruebas de integración (autenticación OAuth simulada, rechazo de otras cuentas, expiración de sesión, CSRF, CORS, CRUD completo, estadísticas y respaldos CSV/JSON):

Requisitos en Linux: `python3` (con `sqlite3` y `httpx`) y `gjs`.

```bash
python3 tests/test_worker_integration.py
python3 tests/test_frontend_and_units.py
python3 tests/test_frontend_e2e.py
```

Para desarrollo diario persistente (guarda datos en `.local/senasconecta.sqlite` e incluye simulador de GitHub OAuth, o `--real-oauth` para usar `worker/.dev.vars`):

```bash
python3 scripts/dev_local.py
```

