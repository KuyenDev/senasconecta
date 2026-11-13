# Carpeta de datos Excel — SeñasConecta (Grupo Señas Osorno)

Coloca aquí tus planillas `.xlsx` (Excel / LibreOffice Calc) o `.csv`.
Puedes usar directamente `plantilla_senasconecta.xlsx` o agregar tus propios archivos `.xlsx`.

## Hojas y columnas reconocidas

### 1. Hoja `Personas`
- `Nombre` *(requerido para importar la fila)*
- `Apellido`
- `Localidad` *(ej. Osorno, Río Negro, Purranque, Puerto Octay, San Pablo, Puyehue, San Juan de la Costa, Río Bueno; si pones otra, se crea automáticamente)*
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

Esto actualiza los JSON en `frontend/data/`. Luego subes los cambios con `git push` para publicarlos en GitHub Pages.

