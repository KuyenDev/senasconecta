# Carpeta de datos y archivos de entrega — SeñasConecta (Grupo Señas Osorno)

Coloca aquí los archivos que recibas con los datos de personas sordas o seguimientos, indicando la **fecha de entrega** para que el sistema integre todo en `frontend/data/*.json` **priorizando siempre el registro más reciente**.

## Formatos admitidos

- **Planillas:** `.xlsx`, `.ods`, `.csv`, `.tsv`
- **Documentos y notas:** `.docx`, `.odt`, `.txt`, `.md` (tablas Markdown, bloques CSV/TSV o fichas tipo `Nombre: ...` / `Localidad: ...`)
- **JSON estructurado:** `.json`
- **PDF, imágenes o formatos antiguos (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.heic`, `.xls`, `.doc`, `.rtf`):** el sistema los conserva en historial y los marca en `meta.json` (`archivos_requieren_revision`) y en la vista **Respaldos** para que no pasen inadvertidos y puedan revisarse o transcribirse.

## Cómo indicar la fecha de entrega (prioridad cronológica)

Para que siempre prevalezca la versión más nueva cuando una persona aparece en varios archivos, nombra el archivo o una subcarpeta con su fecha de entrega:

- `2026-11-15_osorno.xlsx` o `15-11-2026_rahue.docx`
- O agrúpalos por carpeta con fecha: `datos_excel/2026-11-15/notas_san_pablo.txt`

Si el nombre o carpeta no incluye fecha, se toma automáticamente la fecha de modificación del archivo. Los archivos se procesan del más antiguo al más reciente, y un archivo antiguo **nunca sobrescribe** datos ya actualizados con una fecha posterior; además, si una entrega reciente solo trae algunos campos actualizados (por ejemplo solo `Sector` o `Estado`), conserva intactos los demás datos previos de la persona.

> Puedes usar directamente `plantilla_senasconecta.xlsx` como base para nuevas planillas.

## Hojas y columnas reconocidas

### 1. Hoja `Personas`
- `Nombre` *(requerido para importar la fila)*
- `Apellido`
- `Localidad` *(ej. Osorno, Río Negro, San Pablo; si agregas otra en tu Excel, se crea automáticamente)*
- `Sector` *(ej. Rahue Bajo, Francke, Centro)*
- `Fecha incorporacion` *(YYYY-MM-DD o DD/MM/YYYY)*
- `Medio comunicacion` *(ej. LSCh, Escrito, Lectura labial, Bimodal, Señas caseras, Videollamada, Otro)*
- `Usa LSCh` *(`Sí`, `No` o vacío)*
- `Nivel LSCh` *(Básico, Intermedio, Avanzado, Nativo, No aplica)*
- `Prefiere escrita` *(`Sí`, `No` o vacío)*
- `Necesita interpretacion` *(`Sí`, `No` o vacío)*
- `Observaciones comunicacion`
- `Estado` *(`Confirmado`, `Pendiente de actualización`, `Por confirmar`, `Requiere visita`, `Inactivo`)*
- `Ultima visita` *(YYYY-MM-DD o DD/MM/YYYY)*
- `Proxima accion`
- `Observaciones`
- `Codigo` *(opcional; si se omite se genera `SC-0001`, `SC-0002`, etc.)*

### 2. Hoja `Localidades` *(opcional)*
- `Nombre`, `Region`, `Descripcion`, `Latitud`, `Longitud`, `Activa` (`Sí`/`No`)

### 3. Hoja `Seguimientos` *(opcional)*
- `Codigo persona` o `Nombre persona`, `Localidad`, `Fecha`, `Tipo`, `Estado`, `Descripcion`

## Integrar los cambios al sitio web

```bash
python3 scripts/importar_excel.py
```

Esto actualiza los JSON en `frontend/data/`. Para integrar, probar y publicar directo en GitHub Pages con un comando, ejecuta `python3 scripts/publicar.py`.

