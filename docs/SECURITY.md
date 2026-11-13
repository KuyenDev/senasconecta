# Arquitectura de seguridad y privacidad — SeñasConecta

**SeñasConecta** maneja información sensible vinculada a personas identificables y su condición de personas sordas o preferencias de comunicación. Por ello, todas las decisiones técnicas priorizan el principio de mínimo privilegio, defensa en profundidad y resguardo de privacidad.

## 1. Modelo de consulta abierta y único administrador

- **Consulta pública en modo solo lectura:** cualquier visitante puede acceder a la aplicación y consultar los módulos de lectura (`GET` para panel principal, personas, localidades, congregaciones, seguimientos, mapa y estadísticas) sin iniciar sesión.
- **Administración exclusiva por GitHub OAuth:** únicamente el administrador autorizado puede modificar, agregar, eliminar registros, administrar categorías o exportar/importar respaldos (`POST`, `PUT`, `PATCH`, `DELETE` y `/api/respaldos/*`). La autorización se valida en cada operación desde el Worker en Cloudflare.
- **Proveedor único:** GitHub OAuth 2.0 desde el backend en Cloudflare Workers.
- **Sin cuentas adicionales:** no existen registros, invitaciones, contraseñas locales, tokens PAT ni roles secundarios.
- **Alcance mínimo OAuth:** únicamente `read:user`, sin permisos de lectura/escritura sobre repositorios.
- **Validación por ID inmutable:** el Worker consulta `https://api.github.com/user` y compara `user.id` en tiempo constante (mediante hash SHA-256) contra el secreto `ADMIN_GITHUB_ID`. Si no coincide, rechaza el acceso sin crear sesión.
- **Descarte inmediato del token OAuth:** el `access_token` de GitHub se usa una sola vez en memoria para verificar identidad y se descarta de inmediato. Nunca se guarda en D1, cookies ni `localStorage`.

## 2. Protección del flujo OAuth (CSRF de inicio de sesión)

- Al iniciar `/auth/login`, el Worker genera:
  - Un parámetro `state` aleatorio de 256 bits (`crypto.getRandomValues`).
  - Un nonce de enlace `sc_oauth_bind` aleatorio de 256 bits guardado en cookie `HttpOnly; SameSite=Lax` (`Secure` en HTTPS).
- Los hashes SHA-256 de ambos valores se registran en la tabla `oauth_states` con expiración de 10 minutos.
- En `/auth/callback`, el Worker valida y **elimina de forma atómica** la fila en `oauth_states` antes de intercambiar el código OAuth, garantizando uso único e impidiendo ataques de repetición o *Login CSRF*.

## 3. Sesiones seguras y almacenamiento en D1

- Las sesiones se generan con tokens aleatorios de 256 bits y se entregan al navegador exclusivamente mediante cookie `HttpOnly` (`__Host-sc_session` cuando aplica mismo origen HTTPS, o `sc_session` según política de dominio).
- En Cloudflare D1 (`sesiones`), **solo se almacena el hash SHA-256** del token de cookie (`token_hash`), nunca el token en claro.
- Cada sesión tiene expiración configurable (`SESSION_TTL_HOURS`), validación en tiempo real en cada petición protegida y eliminación inmediata al expirar o cerrar sesión (`POST /api/auth/logout`).
- No se almacenan tokens OAuth ni credenciales en `localStorage` ni `sessionStorage`.

## 4. Protección CSRF, CORS y encabezados HTTP

- **CORS estricto:** solo se reflejan orígenes exactos incluidos en `ALLOWED_ORIGINS` / `FRONTEND_URL` con `Access-Control-Allow-Credentials: true`. Nunca se usa comodín `*`.
- **Doble defensa CSRF en mutaciones (`POST`, `PUT`, `PATCH`, `DELETE`):**
  1. Verificación estricta de `Origin` (o `Referer` / `Sec-Fetch-Site`) contra orígenes permitidos.
  2. Verificación en tiempo constante del encabezado `X-CSRF-Token` emitido en memoria para la sesión activa.
- **Encabezados defensivos:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cache-Control: no-store, no-cache, must-revalidate, private`, `Content-Security-Policy` en respuestas API y `Strict-Transport-Security` en HTTPS.

## 5. Protección de datos, SQL e interfaz

- **Consultas preparadas:** todas las consultas a D1 usan `.prepare(...).bind(...)`, y los criterios de ordenamiento provienen exclusivamente de listas blancas explícitas.
- **Protección contra XSS:** el frontend construye todo el DOM mediante creación programática segura (`document.createElement` y `textContent`), sin inyectar HTML dinámico procedente de registros.
- **Mitigación de CSV Injection:** la exportación CSV neutraliza celdas iniciadas con `=`, `+`, `-`, `@`, `\t` o `\r`.
- **Límites de frecuencia (`rate_limits`):** las rutas de autenticación, importación y API limitan ráfagas por ventana de tiempo usando hashes SHA-256 con `SESSION_PEPPER`, sin almacenar direcciones IP en texto claro.
- **Manejo seguro de errores:** ninguna respuesta expone trazas internas, consultas SQL ni variables de entorno.

## 6. Privacidad territorial y minimización de datos

- No se solicitan ni almacenan diagnósticos médicos.
- Los registros personales requieren confirmación explícita de consentimiento (`consentimiento_registrado`).
- El mapa territorial trabaja únicamente con localidades y sectores generales; las coordenadas opcionales corresponden solo a puntos referenciales del centro de la localidad, nunca a domicilios personales.
- No se incluyen datos personales reales ni ficticios en el repositorio ni en migraciones.

