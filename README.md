# SeñasConecta · Grupo Señas Osorno

> *"Conectando personas, acercando corazones."*

**SeñasConecta** es una aplicación web **100 % estática** diseñada para organizar y consultar de forma clara la información territorial de personas sordas vinculada al **Grupo Señas Osorno**, sus localidades, sectores, preferencias de comunicación en Lengua de Señas Chilena (LSCh) y seguimientos territoriales.

Funciona sin servidor ni base de datos externa ni inicio de sesión: lee directamente archivos JSON estáticos (`frontend/data/*.json`) generados desde tus planillas Excel en `datos_excel/`, por lo que se despliega directo en **GitHub Pages** y también funciona de inmediato en servidores locales como Live Server o `python3 -m http.server`.

---

## Cómo se organiza el proyecto

```text
señasConecta/
├── datos_excel/
│   ├── README.md                    # Guía rápida de columnas y hojas Excel
│   └── plantilla_senasconecta.xlsx  # Plantilla vacía lista para llenar
├── docs/
│   ├── INSTALL.md                   # Uso diario, importación Excel y vista local
│   └── DEPLOYMENT.md                # Publicación paso a paso en GitHub Pages
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
│   └── importar_excel.py            # Convierte Excel (.xlsx / .csv) a JSON
├── tests/                           # Pruebas unitarias, importador Excel y E2E
└── .github/workflows/deploy-pages.yml
```

---

## Flujo de actualización con Excel

1. Coloca o actualiza tus archivos `.xlsx` o `.csv` dentro de la carpeta [datos_excel/](datos_excel/README.md) (puedes partir copiando o llenando `plantilla_senasconecta.xlsx`).
2. Integra los datos hacia los JSON del sitio ejecutando en la raíz del proyecto:

```bash
python3 scripts/importar_excel.py
```

- Por defecto el script **integra y actualiza** sin duplicar registros existentes (emparejando por `codigo_interno` o por `nombre + apellido + localidad`).
- Si quieres reemplazar por completo la lista desde cero usando únicamente las planillas presentes en `datos_excel/`, usa:

```bash
python3 scripts/importar_excel.py --replace
```

3. Sube los cambios a GitHub (`git add . && git commit -m "Actualizar datos" && git push`) para que **GitHub Pages** publique automáticamente los JSON actualizados.

---

## Vista local y pruebas

Para probar localmente:

```bash
python3 -m http.server 8000 --directory frontend
```

Y abre `http://127.0.0.1:8000/` en tu navegador (o usa **Live Server** sobre el proyecto apuntando a `frontend/`).

Para ejecutar toda la batería de pruebas automatizadas:

```bash
python3 tests/test_excel_importer.py
python3 tests/test_frontend_and_units.py
python3 tests/test_frontend_e2e.py
```
