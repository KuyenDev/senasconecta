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

## 3. Integrar planillas Excel (.xlsx / .csv)

1. Abre o copia `datos_excel/plantilla_senasconecta.xlsx`, o agrega tus propios archivos `.xlsx` / `.csv` dentro de `datos_excel/`.
2. Consulta el detalle de hojas (`Personas`, `Localidades`, `Seguimientos`) y columnas admitidas en [`datos_excel/README.md`](../datos_excel/README.md).
3. Ejecuta:

```bash
python3 scripts/importar_excel.py
```

El script lee todas las planillas de `datos_excel/`, normaliza fechas, valores `Sí/No` y nombres de localidades, y actualiza:
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

Si prefieres que `personas.json`, `localidades.json` (conservando las 8 localidades base si no se redefinen) y `seguimientos.json` se regeneren desde cero únicamente con lo que haya en `datos_excel/`:

```bash
python3 scripts/importar_excel.py --replace
```
