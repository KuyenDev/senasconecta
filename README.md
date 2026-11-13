# SeñasConecta · Grupo Señas Osorno

> *"Conectando personas, acercando corazones."*

**SeñasConecta** es una aplicación web **100 % estática** diseñada para organizar y consultar de forma clara la información territorial de personas sordas vinculada al **Grupo Señas Osorno**, sus localidades, sectores, preferencias de comunicación en Lengua de Señas Chilena (LSCh) y seguimientos territoriales.

Funciona sin servidor, sin base de datos externa y sin inicio de sesión: lee directamente archivos JSON estáticos (`frontend/data/*.json`) generados desde tus planillas Excel en `datos_excel/`, y se publica automáticamente en **GitHub Pages**.

---

## Cómo se organiza el proyecto

```text
señasConecta/
├── datos_excel/
│   ├── README.md                    # Guía rápida de columnas y hojas Excel
│   └── plantilla_senasconecta.xlsx  # Plantilla vacía lista para llenar
├── docs/
│   ├── INSTALL.md                   # Uso local e integración Excel
│   └── DEPLOYMENT.md                # Publicación automatizada en GitHub Pages
├── frontend/                        # Sitio web estático completo (GitHub Pages)
│   ├── .nojekyll
│   ├── index.html
│   ├── assets/
│   ├── css/styles.css
│   ├── data/                        # Base de datos JSON servida por GitHub Pages
│   │   ├── categorias.json
│   │   ├── localidades.json
│   │   ├── personas.json
│   │   ├── seguimientos.json
│   │   └── meta.json
│   └── js/
├── scripts/
│   ├── importar_excel.py            # Convierte Excel (.xlsx / .csv) a JSON
│   └── publicar.py                  # Automatiza Excel -> pruebas -> Git -> GitHub Pages
├── tests/                           # Pruebas unitarias, importador Excel y E2E
└── .github/workflows/deploy-pages.yml
```

---

## Publicación y actualización automática

1. Coloca o actualiza tus archivos `.xlsx` o `.csv` dentro de [datos_excel/](datos_excel/README.md) (puedes partir copiando o llenando `plantilla_senasconecta.xlsx`).
2. Ejecuta un solo comando en la raíz del proyecto:

```bash
python3 scripts/publicar.py
```

Ese comando automáticamente:
- Integra todas las planillas de `datos_excel/` hacia `frontend/data/*.json` (usa `--replace` si quieres reemplazar desde cero los registros anteriores).
- Ejecuta toda la batería de pruebas locales.
- Crea el commit, sube `main` a GitHub, asegura GitHub Pages activado por GitHub Actions y espera hasta verificar que el sitio web responde en vivo.

> También puedes subir un `.xlsx`/`.csv` a `datos_excel/` directamente desde la web de GitHub: el workflow `.github/workflows/deploy-pages.yml` ejecuta `scripts/importar_excel.py` automáticamente al construir GitHub Pages.

---

## Vista local y pruebas

Para probar localmente:

```bash
python3 -m http.server 8000 --directory frontend
```

Y abre `http://127.0.0.1:8000/` en tu navegador (o usa **Live Server** apuntando a `frontend/`).

Para ejecutar las pruebas por separado:

```bash
python3 tests/test_excel_importer.py
python3 tests/test_frontend_and_units.py
python3 tests/test_frontend_e2e.py
```
