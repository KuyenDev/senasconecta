# Guía de uso local e integración de Excel

SeñasConecta no requiere Node.js, bases de datos ni cuentas de usuario para ejecutarse. Toda la aplicación es HTML/CSS/JavaScript estático que consume archivos JSON ubicados en `frontend/data/`.

---

## 1. Requisitos

- **Python 3** (incluido por defecto en Linux/macOS; se usa únicamente para ejecutar `scripts/importar_excel.py`, servir en local y correr las pruebas — no necesita instalar paquetes externos).
- Un navegador moderno o editor como VS Code con **Live Server**.

---

## 2. Abrir la página en local

En la raíz del repositorio:

```bash
python3 -m http.server 8000 --directory frontend
```

Luego abre `http://127.0.0.1:8000/` en el navegador.

> **Importante:** No abras `frontend/index.html` haciendo doble clic (`file://`), porque los navegadores bloquean la carga de módulos JavaScript y archivos `.json` por razones de seguridad. Usa `python3 -m http.server`, Live Server o GitHub Pages.

---

## 3. Integrar archivos recibidos (.xlsx, .ods, .csv, .docx, .txt, .md, .json)

1. Coloca tus archivos dentro de `datos_excel/` indicando la **fecha en que te los entregaron** (por ejemplo `2026-11-15_datos_osorno.xlsx`, `15-11-2026_san_pablo.docx` o en subcarpetas `datos_excel/2026-11-15/`). También puedes usar `datos_excel/plantilla_senasconecta.xlsx`.
2. Formatos procesados automáticamente: `.xlsx`, `.ods`, `.csv`, `.tsv`, `.json`, `.docx`, `.odt`, `.txt` y `.md` (los archivos `.pdf`, imágenes o `.xls`/`.doc` antiguos quedan registrados en `meta.json` para revisión asistida).
3. Consulta el detalle de hojas (`Personas`, `Localidades`, `Seguimientos`) y columnas admitidas en [`datos_excel/README.md`](../datos_excel/README.md).
4. Ejecuta:

```bash
python3 scripts/importar_excel.py
```

El script ordena todas las fuentes de la más antigua a la más reciente para que **siempre prevalezca la entrega más reciente**, evita que archivos antiguos pisen datos posteriores, combina actualizaciones parciales sin borrar datos previos y actualiza:
- `frontend/data/localidades.json`
- `frontend/data/personas.json`
- `frontend/data/seguimientos.json`
- `frontend/data/categorias.json`
- `frontend/data/meta.json`

### Regenerar la plantilla vacía

Si alguna vez borras o modificas `datos_excel/plantilla_senasconecta.xlsx`, puedes volver a crearla sin perder datos ejecutando:

```bash
python3 scripts/importar_excel.py --crear-plantilla
```

### Reemplazar todo desde Excel

Si prefieres que `personas.json`, `localidades.json` (conservando las 3 localidades base: Osorno, Río Negro y San Pablo, si no se redefinen) y `seguimientos.json` se regeneren desde cero únicamente con lo que haya en `datos_excel/`:

```bash
python3 scripts/importar_excel.py --replace
```
