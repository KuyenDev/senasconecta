# SeñasConecta

> *«Conectando personas, acercando corazones.»*

**SeñasConecta** (`senasconecta`) es una aplicación web diseñada para la consulta, el registro, la organización y el seguimiento territorial de personas sordas, apoyando la labor de comunicación y coordinación en Lengua de Señas Chilena (**LSCh**) y otros medios de comunicación preferidos.

Nace para apoyar la labor del **Grupo Señas Osorno** con un enfoque territorial claro y adaptable que organiza distintas localidades y sectores del sur de Chile (con soporte opcional en el backend para sumar otras congregaciones en el futuro si se requiere).

## Características principales

- **Acceso abierto en modo lectura y administración única por GitHub:** cualquier persona puede ingresar directamente para consultar paneles, fichas, localidades y sectores, seguimientos, mapa y estadísticas; la autenticación mediante GitHub OAuth es exclusiva del administrador autorizado para agregar, editar, eliminar, configurar o gestionar respaldos.
- **Panel principal (Dashboard):** totales dinámicos desde la base de datos, personas que utilizan LSCh o prefieren comunicación escrita, estado de los registros, seguimientos pendientes, distribución por localidad y actividad reciente.
- **Registro de personas:** fichas completas con identificador interno único (`SC-xxxx`), búsqueda por nombre/código/sector, filtros combinables, ordenamiento, preferencias de comunicación (sin asumir que todas las personas usan LSCh) y confirmación de consentimiento.
- **Localidades y sectores:** gestión territorial enfocada en el Grupo Señas Osorno (agregar, editar, activar o desactivar localidades y consultar sectores y fichas asociadas; la API mantiene el módulo de congregaciones disponible para una eventual ampliación futura).
- **Seguimiento territorial:** registro de visitas realizadas o pendientes, confirmaciones, necesidades de interpretación y próximas acciones, vinculadas a personas o a localidades.
- **Mapa territorial opcional:** explorador de localidades y sectores basado en filtros territoriales (funcional sin coordenadas ni mapa externo) más integración opcional con Leaflet y OpenStreetMap utilizando únicamente centros referenciales de localidad (nunca domicilios personales).
- **Estadísticas transparentes:** desglose territorial y de comunicación con tratamiento explícito de datos faltantes para evitar porcentajes engañosos.
- **Respaldos locales (administración):** exportación en CSV (UTF-8 BOM con protección contra inyección de fórmulas) y JSON, e importación JSON con vista previa, validación de estructura, prevención de duplicados y confirmación previa.
- **Seguridad de único administrador:** autenticación exclusiva mediante GitHub OAuth validada en Cloudflare Workers, comparación por `ADMIN_GITHUB_ID`, sesiones por cookie `HttpOnly` almacenadas mediante hash SHA-256 en Cloudflare D1 y protección CSRF/CORS en todas las operaciones de escritura.

## Arquitectura tecnológica

| Capa | Tecnología | Propósito |
| --- | --- | --- |
| Frontend | HTML5, CSS3 y JavaScript puro (ES Modules) | Interfaz estática responsive alojable en GitHub Pages |
| Backend | Cloudflare Workers (JavaScript) | API REST, flujo GitHub OAuth, control de acceso en escritura y validaciones |
| Base de datos | Cloudflare D1 (SQLite) | Almacenamiento normalizado y sesiones hasheadas |

## Estructura del proyecto

```text
senasconecta/
  .github/workflows/
    deploy-pages.yml          # Publicación automática opcional del frontend en GitHub Pages
  frontend/
    index.html
    css/styles.css
    assets/
      logo.svg
      favicon.svg
    js/
      config.js               # URL pública del Cloudflare Worker (sin secretos)
      app.js
      api.js
      auth.js
      charts.js
      components.js
      state.js
      utils.js
      views/
        dashboard.js
        personas.js
        territorio.js
        seguimientos.js
        mapa.js
        estadisticas.js
        respaldos.js
  worker/
    src/
      index.js
      auth.js
      database.js
      validation.js
      utils.js
      middleware/
        auth.js
        cors.js
        rateLimit.js
        security.js
      routes/
        auth.js
        configuracion.js
        congregaciones.js
        dashboard.js
        estadisticas.js
        localidades.js
        personas.js
        respaldos.js
        seguimientos.js
    migrations/
      0001_initial.sql
      0002_seed_defaults.sql
    wrangler.toml
    .dev.vars.example
    package.json
  scripts/
    dev_local.py              # Entorno local persistente sin Node/Wrangler
  tests/                      # Pruebas automatizadas y entorno de ejecución local
  docs/
    INSTALL.md                # Instalación y pruebas locales
    DEPLOYMENT.md             # Guía paso a paso para GitHub Pages, Cloudflare Worker, D1 y OAuth
    SECURITY.md               # Modelo de seguridad, cookies entre dominios y privacidad
```

## Uso rápido en desarrollo local

```bash
python3 scripts/dev_local.py
```

Esto levanta la base SQLite persistente en `.local/senasconecta.sqlite`, el Worker en `http://127.0.0.1:8787` (compatible también con Live Server en `:5500`) y el frontend en `http://127.0.0.1:8080/`.

## Documentación

- [Guía de instalación y pruebas locales](docs/INSTALL.md)
- [Guía completa de despliegue en producción](docs/DEPLOYMENT.md)
- [Arquitectura de seguridad, OAuth y privacidad](docs/SECURITY.md)

