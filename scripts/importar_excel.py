#!/usr/bin/env python3
"""Integra archivos recibidos (.xlsx, .ods, .csv, .tsv, .json, .docx, .odt, .txt, .md)
desde datos_excel/ hacia la base JSON estática en frontend/data/, priorizando
siempre los archivos con fecha de entrega más reciente.

Sin dependencias externas: usa únicamente la biblioteca estándar de Python 3.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import pathlib
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from xml.sax.saxutils import escape

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
EXCEL_DIR = ROOT_DIR / 'datos_excel'
DATA_DIR = ROOT_DIR / 'frontend' / 'data'

SEED_CATEGORIAS = {
    'estado_registro': [
        {'clave': 'confirmado', 'etiqueta': 'Confirmado', 'orden': 1, 'activa': 1},
        {'clave': 'pendiente_actualizacion', 'etiqueta': 'Pendiente de actualización', 'orden': 2, 'activa': 1},
        {'clave': 'por_confirmar', 'etiqueta': 'Por confirmar', 'orden': 3, 'activa': 1},
        {'clave': 'requiere_visita', 'etiqueta': 'Requiere visita', 'orden': 4, 'activa': 1},
        {'clave': 'inactivo', 'etiqueta': 'Inactivo / Trasladado', 'orden': 5, 'activa': 1},
    ],
    'medio_comunicacion': [
        {'clave': 'lsch', 'etiqueta': 'Lengua de Señas Chilena (LSCh)', 'orden': 1, 'activa': 1},
        {'clave': 'escrito', 'etiqueta': 'Comunicación escrita', 'orden': 2, 'activa': 1},
        {'clave': 'lectura_labial', 'etiqueta': 'Lectura labial', 'orden': 3, 'activa': 1},
        {'clave': 'bimodal', 'etiqueta': 'Bimodal / Mixto', 'orden': 4, 'activa': 1},
        {'clave': 'senas_caseras', 'etiqueta': 'Señas familiares o naturales', 'orden': 5, 'activa': 1},
        {'clave': 'videollamada', 'etiqueta': 'Videollamada en señas', 'orden': 6, 'activa': 1},
        {'clave': 'otro', 'etiqueta': 'Otro medio', 'orden': 7, 'activa': 1},
    ],
    'nivel_lsch': [
        {'clave': 'basico', 'etiqueta': 'Básico', 'orden': 1, 'activa': 1},
        {'clave': 'intermedio', 'etiqueta': 'Intermedio', 'orden': 2, 'activa': 1},
        {'clave': 'avanzado', 'etiqueta': 'Avanzado', 'orden': 3, 'activa': 1},
        {'clave': 'nativo', 'etiqueta': 'Fluido / Nativo', 'orden': 4, 'activa': 1},
        {'clave': 'no_aplica', 'etiqueta': 'No utiliza LSCh', 'orden': 5, 'activa': 1},
    ],
    'tipo_seguimiento': [
        {'clave': 'visita_realizada', 'etiqueta': 'Visita realizada', 'orden': 1, 'activa': 1},
        {'clave': 'visita_pendiente', 'etiqueta': 'Visita pendiente', 'orden': 2, 'activa': 1},
        {'clave': 'confirmar_info', 'etiqueta': 'Información por confirmar', 'orden': 3, 'activa': 1},
        {'clave': 'info_desactualizada', 'etiqueta': 'Información desactualizada', 'orden': 4, 'activa': 1},
        {'clave': 'necesidad_interpretacion', 'etiqueta': 'Necesidad de interpretación', 'orden': 5, 'activa': 1},
        {'clave': 'proxima_accion', 'etiqueta': 'Próxima acción', 'orden': 6, 'activa': 1},
    ],
    'estado_seguimiento': [
        {'clave': 'pendiente', 'etiqueta': 'Pendiente', 'orden': 1, 'activa': 1},
        {'clave': 'en_curso', 'etiqueta': 'En curso', 'orden': 2, 'activa': 1},
        {'clave': 'completado', 'etiqueta': 'Completado', 'orden': 3, 'activa': 1},
        {'clave': 'cancelado', 'etiqueta': 'Cancelado', 'orden': 4, 'activa': 1},
    ],
}

SEED_LOCALIDADES = [
    {
        'id': 1,
        'nombre': 'Osorno',
        'region': 'Región de Los Lagos',
        'descripcion': 'Capital provincial y punto de coordinación territorial amplio.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
    {
        'id': 2,
        'nombre': 'Río Negro',
        'region': 'Región de Los Lagos',
        'descripcion': 'Localidad y sectores rurales circundantes.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
    {
        'id': 3,
        'nombre': 'San Pablo',
        'region': 'Región de Los Lagos',
        'descripcion': 'Localidad del sector norte provincial.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
]

PERSON_TEMPLATE_HEADERS = [
    'Codigo',
    'Nombre',
    'Apellido',
    'Localidad',
    'Sector',
    'Fecha incorporacion',
    'Medio comunicacion',
    'Usa LSCh',
    'Nivel LSCh',
    'Prefiere escrita',
    'Necesita interpretacion',
    'Observaciones comunicacion',
    'Estado',
    'Ultima visita',
    'Proxima accion',
    'Observaciones',
]

LOCALIDAD_TEMPLATE_HEADERS = [
    'Nombre',
    'Region',
    'Descripcion',
    'Latitud',
    'Longitud',
    'Activa',
]

SEGUIMIENTO_TEMPLATE_HEADERS = [
    'Codigo persona',
    'Nombre persona',
    'Localidad',
    'Fecha',
    'Tipo',
    'Estado',
    'Descripcion',
]

SUPPORTED_DATA_EXTS = {'.xlsx', '.ods', '.csv', '.tsv', '.json', '.docx', '.odt', '.txt', '.md'}
REVIEW_REQUIRED_EXTS = {'.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.xls', '.doc', '.rtf'}

KEY_ALIASES = {
    'codigo': 'codigo_interno',
    'cod': 'codigo_interno',
    'codigo_interno': 'codigo_interno',
    'id_interno': 'codigo_interno',
    'nombre': 'nombre',
    'nombres': 'nombre',
    'persona': 'nombre',
    'apellido': 'apellido',
    'apellidos': 'apellido',
    'localidad': 'localidad',
    'comuna': 'localidad',
    'ciudad': 'localidad',
    'sector': 'sector',
    'sector_o_barrio': 'sector',
    'barrio': 'sector',
    'zona': 'sector',
    'direccion_referencial': 'sector',
    'fecha_incorporacion': 'fecha_incorporacion',
    'incorporacion': 'fecha_incorporacion',
    'fecha_ingreso': 'fecha_incorporacion',
    'fecha_registro': 'fecha_incorporacion',
    'medio_comunicacion': 'medio_comunicacion',
    'medio': 'medio_comunicacion',
    'medio_preferido': 'medio_comunicacion',
    'comunicacion': 'medio_comunicacion',
    'usa_lsch': 'usa_lsch',
    'utiliza_lsch': 'usa_lsch',
    'lsch': 'usa_lsch',
    'nivel_lsch': 'nivel_lsch',
    'nivel': 'nivel_lsch',
    'prefiere_escrita': 'prefiere_escrita',
    'comunicacion_escrita': 'prefiere_escrita',
    'escrita': 'prefiere_escrita',
    'necesita_interpretacion': 'necesita_interpretacion',
    'requiere_interpretacion': 'necesita_interpretacion',
    'interpretacion': 'necesita_interpretacion',
    'observaciones_comunicacion': 'observaciones_comunicacion',
    'notas_comunicacion': 'observaciones_comunicacion',
    'estado': 'estado',
    'estado_registro': 'estado',
    'fecha_ultima_visita': 'fecha_ultima_visita',
    'ultima_visita': 'fecha_ultima_visita',
    'fecha_visita': 'fecha_ultima_visita',
    'proxima_accion': 'proxima_accion',
    'accion_pendiente': 'proxima_accion',
    'observaciones': 'observaciones',
    'notas': 'observaciones',
    'comentarios': 'observaciones',
    'consentimiento': 'consentimiento_registrado',
    'consentimiento_registrado': 'consentimiento_registrado',
    'nota_consentimiento': 'nota_consentimiento',
    'fecha_entrega': 'fecha_entrega',
    'fecha_archivo': 'fecha_entrega',
    'fecha_dato': 'fecha_entrega',
}


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', '.000Z')


def norm_key(text: object) -> str:
    s = unicodedata.normalize('NFD', str(text or '').strip().lower())
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')
    return s


def _col_ref_to_idx(ref: str) -> int:
    letters = ''.join(ch for ch in ref if ch.isalpha()).upper()
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord('A') + 1)
    return max(0, idx - 1)


def _col_idx_to_letters(idx: int) -> str:
    idx += 1
    out = []
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        out.append(chr(ord('A') + rem))
    return ''.join(reversed(out))


def _tag_name(elem: ET.Element) -> str:
    return elem.tag.split('}')[-1]


def _excel_serial_to_date(val: float) -> str:
    base = dt.datetime(1899, 12, 30)
    parsed = base + dt.timedelta(days=float(val))
    return parsed.date().isoformat()


def _valid_iso_date(year: int, month: int, day: int) -> str | None:
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None


def extract_date_from_text(text: str) -> str | None:
    """Extrae una fecha YYYY-MM-DD válida desde un nombre de archivo o carpeta."""
    for m in re.finditer(r'(?<!\d)(20\d{2})[-_. ](\d{1,2})[-_. ](\d{1,2})(?!\d)', text):
        iso = _valid_iso_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if iso:
            return iso
    for m in re.finditer(r'(?<!\d)(\d{1,2})[-_. ](\d{1,2})[-_. ](20\d{2})(?!\d)', text):
        iso = _valid_iso_date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        if iso:
            return iso
    for m in re.finditer(r'(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)', text):
        iso = _valid_iso_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if iso:
            return iso
    return None


def extract_delivery_date(path: pathlib.Path, base_dir: pathlib.Path) -> tuple[str, str]:
    """Determina la fecha de entrega del archivo (prioriza nombre de archivo, luego carpeta, luego mtime)."""
    rel = path.relative_to(base_dir)
    candidates = [path.stem] + [part for part in reversed(rel.parts[:-1])]
    for part in candidates:
        iso = extract_date_from_text(part)
        if iso:
            return iso, 'nombre'
    mtime_date = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).date().isoformat()
    return mtime_date, 'archivo'


def read_xlsx_sheets(path: pathlib.Path) -> list[tuple[str, list[list[str]]]]:
    """Lee todas las hojas de un archivo .xlsx sin dependencias externas."""
    with zipfile.ZipFile(path, 'r') as zf:
        names = set(zf.namelist())

        shared_strings: list[str] = []
        if 'xl/sharedStrings.xml' in names:
            root = ET.fromstring(zf.read('xl/sharedStrings.xml'))
            for si in root:
                if _tag_name(si) != 'si':
                    continue
                parts = []
                for elem in si.iter():
                    if _tag_name(elem) == 't' and elem.text is not None:
                        parts.append(elem.text)
                shared_strings.append(''.join(parts))

        date_style_indices: set[int] = set()
        if 'xl/styles.xml' in names:
            styles_root = ET.fromstring(zf.read('xl/styles.xml'))
            custom_date_fmts: set[int] = set()
            for num_fmt in styles_root.iter():
                if _tag_name(num_fmt) == 'numFmt':
                    fmt_id = int(num_fmt.attrib.get('numFmtId', '-1'))
                    code = str(num_fmt.attrib.get('formatCode', '')).lower()
                    cleaned = re.sub(r'\[[^\]]*\]|"[^"]*"', '', code)
                    if any(ch in cleaned for ch in ('y', 'd')) and '%' not in cleaned:
                        custom_date_fmts.add(fmt_id)
            builtin_dates = {14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47}
            for child in styles_root:
                if _tag_name(child) == 'cellXfs':
                    for xf_idx, xf in enumerate(child):
                        num_fmt_id = int(xf.attrib.get('numFmtId', '0'))
                        if num_fmt_id in builtin_dates or num_fmt_id in custom_date_fmts:
                            date_style_indices.add(xf_idx)

        rel_map: dict[str, str] = {}
        if 'xl/_rels/workbook.xml.rels' in names:
            rels_root = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
            for rel in rels_root:
                rid = rel.attrib.get('Id')
                target = rel.attrib.get('Target', '').lstrip('/')
                if rid and target:
                    if not target.startswith('xl/'):
                        target = f'xl/{target}'
                    rel_map[rid] = target

        sheet_specs: list[tuple[str, str]] = []
        if 'xl/workbook.xml' in names:
            wb_root = ET.fromstring(zf.read('xl/workbook.xml'))
            for elem in wb_root.iter():
                if _tag_name(elem) == 'sheet':
                    sheet_name = elem.attrib.get('name', 'Hoja')
                    rid = next((v for k, v in elem.attrib.items() if k.endswith('}id') or k == 'r:id'), '')
                    target = rel_map.get(rid)
                    if target and target in names:
                        sheet_specs.append((sheet_name, target))

        if not sheet_specs:
            for ws_name in sorted(n for n in names if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')):
                sheet_specs.append((pathlib.Path(ws_name).stem, ws_name))

        results: list[tuple[str, list[list[str]]]] = []
        for sheet_name, ws_path in sheet_specs:
            ws_root = ET.fromstring(zf.read(ws_path))
            rows: list[list[str]] = []
            for row_el in ws_root.iter():
                if _tag_name(row_el) != 'row':
                    continue
                cells_map: dict[int, str] = {}
                max_col = -1
                fallback_col = 0
                for c_el in row_el:
                    if _tag_name(c_el) != 'c':
                        continue
                    ref = c_el.attrib.get('r', '')
                    col_idx = _col_ref_to_idx(ref) if ref else fallback_col
                    fallback_col = col_idx + 1
                    max_col = max(max_col, col_idx)

                    c_type = c_el.attrib.get('t', '')
                    style_idx = int(c_el.attrib.get('s', '-1')) if c_el.attrib.get('s', '').isdigit() else -1
                    v_text = ''
                    inline_parts = []
                    for child in c_el:
                        tname = _tag_name(child)
                        if tname == 'v' and child.text is not None:
                            v_text = child.text
                        elif tname == 'is':
                            for t_el in child.iter():
                                if _tag_name(t_el) == 't' and t_el.text is not None:
                                    inline_parts.append(t_el.text)

                    if c_type == 's' and v_text.isdigit():
                        idx = int(v_text)
                        val = shared_strings[idx] if 0 <= idx < len(shared_strings) else ''
                    elif c_type == 'inlineStr':
                        val = ''.join(inline_parts)
                    elif c_type == 'b':
                        val = 'Sí' if v_text == '1' else 'No'
                    elif c_type in ('str', 'e'):
                        val = v_text
                    elif v_text != '' and style_idx in date_style_indices:
                        try:
                            val = _excel_serial_to_date(float(v_text))
                        except ValueError:
                            val = v_text
                    else:
                        val = v_text

                    cells_map[col_idx] = val.strip()

                if max_col >= 0:
                    row_vals = [cells_map.get(i, '') for i in range(max_col + 1)]
                    if any(cell != '' for cell in row_vals):
                        rows.append(row_vals)
            results.append((sheet_name, rows))
        return results


def _read_odf_table_rows(table_el: ET.Element) -> list[list[str]]:
    rows: list[list[str]] = []
    for row_el in table_el:
        if _tag_name(row_el) != 'table-row':
            continue
        row_vals: list[str] = []
        for cell_el in row_el:
            if _tag_name(cell_el) not in ('table-cell', 'covered-table-cell'):
                continue
            repeat = 1
            for k, v in cell_el.attrib.items():
                if k.endswith('number-columns-repeated') and v.isdigit():
                    repeat = min(int(v), 64)
            date_val = next((v for k, v in cell_el.attrib.items() if k.endswith('date-value')), '')
            parts = []
            for p_el in cell_el:
                if _tag_name(p_el) == 'p':
                    parts.append(''.join(p_el.itertext()).strip())
            cell_text = ' '.join(p for p in parts if p).strip() or date_val.strip()
            if repeat > 1 and not cell_text:
                # Ignora relleno final vacío de columnas repetidas en LibreOffice
                row_vals.extend([''] * min(repeat, 8))
            else:
                row_vals.extend([cell_text] * repeat)
        while row_vals and row_vals[-1] == '':
            row_vals.pop()
        if any(c != '' for c in row_vals):
            rows.append(row_vals)
    return rows


def read_ods_sheets(path: pathlib.Path) -> list[tuple[str, list[list[str]]]]:
    """Lee todas las hojas de un archivo LibreOffice Calc (.ods)."""
    with zipfile.ZipFile(path, 'r') as zf:
        root = ET.fromstring(zf.read('content.xml'))
    results: list[tuple[str, list[list[str]]]] = []
    for elem in root.iter():
        if _tag_name(elem) == 'table':
            name = next((v for k, v in elem.attrib.items() if k.endswith('name')), path.stem)
            rows = _read_odf_table_rows(elem)
            if rows:
                results.append((name, rows))
    return results


def write_xlsx_workbook(path: pathlib.Path, sheets: list[tuple[str, list[list[object]]]]) -> None:
    """Genera un archivo .xlsx válido usando únicamente zipfile + XML estándar."""
    path.parent.mkdir(parents=True, exist_ok=True)
    shared: list[str] = []
    shared_index: dict[str, int] = {}

    def intern(val: object) -> int:
        s = str(val)
        if s not in shared_index:
            shared_index[s] = len(shared)
            shared.append(s)
        return shared_index[s]

    sheet_xml_blobs: list[str] = []
    for _sheet_name, rows in sheets:
        row_xml = []
        for r_idx, row in enumerate(rows, start=1):
            c_xml = []
            style = ' s="1"' if r_idx == 1 else ''
            for c_idx, val in enumerate(row):
                if val is None or val == '':
                    continue
                ref = f'{_col_idx_to_letters(c_idx)}{r_idx}'
                if isinstance(val, (int, float)) and not isinstance(val, bool) and r_idx > 1:
                    c_xml.append(f'<c r="{ref}"{style}><v>{val}</v></c>')
                else:
                    s_idx = intern(val)
                    c_xml.append(f'<c r="{ref}" t="s"{style}><v>{s_idx}</v></c>')
            if c_xml:
                row_xml.append(f'<row r="{r_idx}">{"".join(c_xml)}</row>')
        sheet_xml_blobs.append(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<sheetData>{"".join(row_xml)}</sheetData>'
            '</worksheet>'
        )

    ss_items = ''.join(f'<si><t xml:space="preserve">{escape(s)}</t></si>' for s in shared)
    shared_strings_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
        f'{ss_items}</sst>'
    )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        '</fonts>'
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF163024"/></patternFill></fill>'
        '</fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
        '</cellXfs>'
        '</styleSheet>'
    )

    wb_sheets = []
    wb_rels = [
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>',
    ]
    ct_overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
    ]

    for i, (sheet_name, _rows) in enumerate(sheets, start=1):
        safe_name = escape(sheet_name[:31])
        wb_sheets.append(f'<sheet name="{safe_name}" sheetId="{i}" r:id="rId{i}"/>')
        wb_rels.append(
            f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
        )
        ct_overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets>{"".join(wb_sheets)}</sheets></workbook>'
    )
    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{"".join(wb_rels)}</Relationships>'
    )
    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f'{"".join(ct_overrides)}</Types>'
    )

    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', content_types_xml)
        zf.writestr('_rels/.rels', root_rels_xml)
        zf.writestr('xl/workbook.xml', workbook_xml)
        zf.writestr('xl/_rels/workbook.xml.rels', workbook_rels_xml)
        zf.writestr('xl/styles.xml', styles_xml)
        zf.writestr('xl/sharedStrings.xml', shared_strings_xml)
        for i, ws_xml in enumerate(sheet_xml_blobs, start=1):
            zf.writestr(f'xl/worksheets/sheet{i}.xml', ws_xml)


def _decode_text_bytes(raw: bytes) -> str:
    for enc in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return ''


def read_csv_rows(path: pathlib.Path, forced_delimiter: str | None = None) -> list[list[str]]:
    text = _decode_text_bytes(path.read_bytes())
    if not text:
        return []
    sample = '\n'.join(text.splitlines()[:5])
    delimiter = forced_delimiter or ','
    if not forced_delimiter:
        if sample.count(';') > sample.count(','):
            delimiter = ';'
        elif sample.count('\t') > sample.count(','):
            delimiter = '\t'
    reader = csv.reader(text.splitlines(), delimiter=delimiter)
    return [[cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)]


def _dicts_to_table_rows(items: list[dict]) -> list[list[str]]:
    keys: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        for k in item.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)
    if not keys:
        return []
    rows = [keys]
    for item in items:
        if not isinstance(item, dict):
            continue
        rows.append(['' if item.get(k) is None else str(item.get(k)) for k in keys])
    return rows


def read_json_sheets(path: pathlib.Path) -> list[tuple[str, list[list[str]]]]:
    """Lee un archivo .json con lista de personas o estructura {localidades, personas, seguimientos}."""
    raw = json.loads(_decode_text_bytes(path.read_bytes()))
    batches: list[tuple[str, list[list[str]]]] = []
    if isinstance(raw, list):
        rows = _dicts_to_table_rows(raw)
        if rows:
            batches.append((path.stem, rows))
        return batches
    if isinstance(raw, dict):
        for section, sheet_name in (
            ('localidades', 'Localidades'),
            ('personas', 'Personas'),
            ('seguimientos', 'Seguimientos'),
        ):
            items = raw.get(section)
            if isinstance(items, list) and items:
                rows = _dicts_to_table_rows(items)
                if rows:
                    batches.append((sheet_name, rows))
    return batches


def parse_text_to_sheets(text: str, default_name: str = 'Personas') -> list[tuple[str, list[list[str]]]]:
    """Convierte tablas Markdown, CSV/TSV incrustado o bloques 'Campo: valor' en filas estructuradas."""
    lines = [line.rstrip() for line in text.splitlines()]
    sheets: list[tuple[str, list[list[str]]]] = []

    # 1. Tablas Markdown con pipes (| col1 | col2 |)
    md_block: list[list[str]] = []
    consumed_lines: set[int] = set()
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('|') and stripped.endswith('|') and stripped.count('|') >= 2:
            if re.fullmatch(r'[\|\s:\-]+', stripped):
                consumed_lines.add(idx)
                continue
            cells = [c.strip() for c in stripped.strip('|').split('|')]
            md_block.append(cells)
            consumed_lines.add(idx)
        elif md_block:
            if len(md_block) >= 2:
                sheets.append((default_name, md_block))
            md_block = []
    if len(md_block) >= 2:
        sheets.append((default_name, md_block))

    remaining = [line for idx, line in enumerate(lines) if idx not in consumed_lines]

    # 2. Encabezado CSV/TSV claro en texto plano
    non_empty = [line.strip() for line in remaining if line.strip()]
    if non_empty:
        for delim in (';', '\t', ','):
            if non_empty[0].count(delim) >= 2:
                first_headers = {norm_key(h) for h in next(csv.reader([non_empty[0]], delimiter=delim))}
                if first_headers & {'nombre', 'nombres', 'localidad', 'sector', 'estado', 'usa_lsch'}:
                    parsed = [row for row in csv.reader(non_empty, delimiter=delim) if any(c.strip() for c in row)]
                    if len(parsed) >= 2:
                        sheets.append((default_name, [[c.strip() for c in r] for r in parsed]))
                        return sheets

    # 3. Bloques clave: valor separados por líneas en blanco o ---
    kv_records: list[dict[str, str]] = []
    cur: dict[str, str] = {}
    kv_pattern = re.compile(r'^(?:[-*•]\s*)?([A-Za-zÁÉÍÓÚáéíóúÑñ0-9 _/]{2,36})\s*:\s*(.+)$')
    for line in remaining:
        stripped = line.strip()
        if not stripped or re.fullmatch(r'[-_=]{3,}', stripped):
            if cur:
                kv_records.append(cur)
                cur = {}
            continue
        m = kv_pattern.match(stripped)
        if not m:
            continue
        raw_k = norm_key(m.group(1))
        canon_k = KEY_ALIASES.get(raw_k, raw_k)
        val = m.group(2).strip()
        # Si aparece un nuevo 'nombre' y el bloque actual ya tiene 'nombre', iniciar nuevo registro
        if canon_k in ('nombre', 'codigo_interno') and canon_k in cur:
            kv_records.append(cur)
            cur = {}
        cur[canon_k] = val
    if cur:
        kv_records.append(cur)

    valid_records = [r for r in kv_records if 'nombre' in r or ('tipo' in r and 'observaciones' in r)]
    if valid_records:
        rows = _dicts_to_table_rows(valid_records)
        if rows:
            sheets.append((default_name, rows))

    return sheets


def read_docx_sheets(path: pathlib.Path) -> list[tuple[str, list[list[str]]]]:
    """Lee tablas y párrafos clave-valor de un documento Word (.docx)."""
    with zipfile.ZipFile(path, 'r') as zf:
        if 'word/document.xml' not in zf.namelist():
            return []
        root = ET.fromstring(zf.read('word/document.xml'))

    results: list[tuple[str, list[list[str]]]] = []
    body = next((el for el in root.iter() if _tag_name(el) == 'body'), root)
    paragraph_lines: list[str] = []

    for child in body:
        tname = _tag_name(child)
        if tname == 'tbl':
            table_rows: list[list[str]] = []
            for tr in child:
                if _tag_name(tr) != 'tr':
                    continue
                row_cells: list[str] = []
                for tc in tr:
                    if _tag_name(tc) != 'tc':
                        continue
                    cell_text = ' '.join(
                        ''.join(p.itertext()).strip()
                        for p in tc.iter()
                        if _tag_name(p) == 'p' and ''.join(p.itertext()).strip()
                    )
                    row_cells.append(cell_text)
                if any(c != '' for c in row_cells):
                    table_rows.append(row_cells)
            if len(table_rows) >= 2:
                results.append((path.stem, table_rows))
        elif tname == 'p':
            txt = ''.join(child.itertext()).strip()
            paragraph_lines.append(txt)
        else:
            paragraph_lines.append('')

    if any(paragraph_lines):
        results.extend(parse_text_to_sheets('\n'.join(paragraph_lines), path.stem))
    return results


def read_odt_sheets(path: pathlib.Path) -> list[tuple[str, list[list[str]]]]:
    """Lee tablas y párrafos clave-valor de un documento LibreOffice Writer (.odt)."""
    with zipfile.ZipFile(path, 'r') as zf:
        if 'content.xml' not in zf.namelist():
            return []
        root = ET.fromstring(zf.read('content.xml'))

    results: list[tuple[str, list[list[str]]]] = []
    text_lines: list[str] = []
    office_text = next((el for el in root.iter() if _tag_name(el) == 'text'), root)

    for child in office_text:
        tname = _tag_name(child)
        if tname == 'table':
            table_rows = _read_odf_table_rows(child)
            if len(table_rows) >= 2:
                results.append((path.stem, table_rows))
        elif tname in ('p', 'h'):
            text_lines.append(''.join(child.itertext()).strip())
        elif tname == 'list':
            for item in child.iter():
                if _tag_name(item) == 'p':
                    text_lines.append(''.join(item.itertext()).strip())
            text_lines.append('')

    if any(text_lines):
        results.extend(parse_text_to_sheets('\n'.join(text_lines), path.stem))
    return results


def read_any_source_sheets(path: pathlib.Path) -> list[tuple[str, list[list[str]]]]:
    ext = path.suffix.lower()
    if ext == '.xlsx':
        return read_xlsx_sheets(path)
    if ext == '.ods':
        return read_ods_sheets(path)
    if ext == '.csv':
        return [(path.stem, read_csv_rows(path))]
    if ext == '.tsv':
        return [(path.stem, read_csv_rows(path, forced_delimiter='\t'))]
    if ext == '.json':
        return read_json_sheets(path)
    if ext == '.docx':
        return read_docx_sheets(path)
    if ext == '.odt':
        return read_odt_sheets(path)
    if ext in ('.txt', '.md'):
        text = _decode_text_bytes(path.read_bytes())
        return parse_text_to_sheets(text, path.stem)
    return []


def parse_tri_bool(val: object) -> int | None:
    k = norm_key(val)
    if k in ('1', 'si', 's', 'true', 'yes', 'y', 'x', 'activa', 'activo'):
        return 1
    if k in ('0', 'no', 'n', 'false', 'inactiva', 'inactivo'):
        return 0
    return None


def parse_date(val: object) -> str | None:
    s = str(val or '').strip()
    if not s or s in ('—', '-', 'N/A', 'n/a'):
        return None
    if re.fullmatch(r'\d{5}(?:\.0+)?', s):
        return _excel_serial_to_date(float(s))
    m_iso = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', s)
    if m_iso:
        return _valid_iso_date(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3)))
    m_lat = re.match(r'^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})', s)
    if m_lat:
        return _valid_iso_date(int(m_lat.group(3)), int(m_lat.group(2)), int(m_lat.group(1)))
    return None


def parse_float_or_none(val: object) -> float | None:
    s = str(val or '').strip().replace(',', '.')
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def map_category(val: object, mappings: dict[str, str], default: str) -> str:
    k = norm_key(val)
    if not k:
        return default
    if k in mappings.values():
        return k
    return mappings.get(k, default)


ESTADO_REGISTRO_MAP = {
    'confirmado': 'confirmado',
    'confirmada': 'confirmado',
    'al_dia': 'confirmado',
    'pendiente_actualizacion': 'pendiente_actualizacion',
    'pendiente_de_actualizacion': 'pendiente_actualizacion',
    'actualizar': 'pendiente_actualizacion',
    'desactualizado': 'pendiente_actualizacion',
    'por_confirmar': 'por_confirmar',
    'pendiente': 'por_confirmar',
    'requiere_visita': 'requiere_visita',
    'visita_pendiente': 'requiere_visita',
    'visita': 'requiere_visita',
    'inactivo': 'inactivo',
    'inactivo_trasladado': 'inactivo',
    'trasladado': 'inactivo',
}

MEDIO_MAP = {
    'lsch': 'lsch',
    'lengua_de_senas_chilena_lsch': 'lsch',
    'lengua_de_senas_chilena': 'lsch',
    'lengua_de_senas': 'lsch',
    'senas': 'lsch',
    'escrito': 'escrito',
    'escrita': 'escrito',
    'comunicacion_escrita': 'escrito',
    'lectura_labial': 'lectura_labial',
    'bimodal': 'bimodal',
    'bimodal_mixto': 'bimodal',
    'mixto': 'bimodal',
    'senas_caseras': 'senas_caseras',
    'senas_familiares_o_naturales': 'senas_caseras',
    'videollamada': 'videollamada',
    'videollamada_en_senas': 'videollamada',
    'otro': 'otro',
    'otro_medio': 'otro',
}

NIVEL_LSCH_MAP = {
    'basico': 'basico',
    'intermedio': 'intermedio',
    'avanzado': 'avanzado',
    'nativo': 'nativo',
    'fluido': 'nativo',
    'fluido_nativo': 'nativo',
    'no_aplica': 'no_aplica',
    'no_utiliza_lsch': 'no_aplica',
    'ninguno': 'no_aplica',
}

TIPO_SEG_MAP = {
    'visita_realizada': 'visita_realizada',
    'visita_pendiente': 'visita_pendiente',
    'confirmar_info': 'confirmar_info',
    'informacion_por_confirmar': 'confirmar_info',
    'info_desactualizada': 'info_desactualizada',
    'informacion_desactualizada': 'info_desactualizada',
    'necesidad_interpretacion': 'necesidad_interpretacion',
    'necesidad_de_interpretacion': 'necesidad_interpretacion',
    'proxima_accion': 'proxima_accion',
}

ESTADO_SEG_MAP = {
    'pendiente': 'pendiente',
    'en_curso': 'en_curso',
    'en_proceso': 'en_curso',
    'completado': 'completado',
    'completada': 'completado',
    'realizado': 'completado',
    'realizada': 'completado',
    'cancelado': 'cancelado',
    'cancelada': 'cancelado',
}


def rows_to_dicts(rows: list[list[str]]) -> tuple[set[str], list[dict[str, str]]]:
    if len(rows) < 1:
        return set(), []
    headers = [norm_key(h) for h in rows[0]]
    dicts: list[dict[str, str]] = []
    for row in rows[1:]:
        record: dict[str, str] = {}
        for idx, h in enumerate(headers):
            if not h:
                continue
            record[h] = row[idx] if idx < len(row) else ''
        if any(v != '' for v in record.values()):
            dicts.append(record)
    return set(h for h in headers if h), dicts


def detect_sheet_kind(sheet_name: str, headers: set[str]) -> str:
    s_norm = norm_key(sheet_name)
    if 'localidad' in s_norm and 'persona' not in s_norm and 'nombre_persona' not in headers:
        return 'localidades'
    if 'seguimiento' in s_norm or ('tipo' in headers and 'descripcion' in headers and 'nombre' not in headers):
        return 'seguimientos'
    if 'nombre' in headers or 'nombres' in headers or 'persona' in headers or 'personas' in s_norm:
        if 'region' in headers or 'latitud' in headers:
            if 'apellido' not in headers and 'apellidos' not in headers and 'sector' not in headers and 'estado' not in headers:
                return 'localidades'
        return 'personas'
    return 'unknown'


def pick(row: dict[str, str], *aliases: str) -> str:
    for key in aliases:
        if key in row and row[key] != '':
            return row[key]
    return ''


def load_json_list(path: pathlib.Path, fallback: list[dict]) -> list[dict]:
    if not path.exists():
        return [dict(item) for item in fallback]
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, list) else [dict(item) for item in fallback]
    except Exception:
        return [dict(item) for item in fallback]


def create_excel_template(excel_dir: pathlib.Path = EXCEL_DIR) -> pathlib.Path:
    excel_dir.mkdir(parents=True, exist_ok=True)
    target = excel_dir / 'plantilla_senasconecta.xlsx'
    write_xlsx_workbook(
        target,
        [
            ('Personas', [PERSON_TEMPLATE_HEADERS]),
            ('Localidades', [LOCALIDAD_TEMPLATE_HEADERS]),
            ('Seguimientos', [SEGUIMIENTO_TEMPLATE_HEADERS]),
        ],
    )
    return target


def sync_excel_to_json(
    excel_dir: pathlib.Path = EXCEL_DIR,
    data_dir: pathlib.Path = DATA_DIR,
    replace: bool = False,
) -> dict:
    excel_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    now = utc_now_iso()

    localidades = (
        [dict(item) for item in SEED_LOCALIDADES]
        if replace
        else load_json_list(data_dir / 'localidades.json', SEED_LOCALIDADES)
    )
    personas = [] if replace else load_json_list(data_dir / 'personas.json', [])
    seguimientos = [] if replace else load_json_list(data_dir / 'seguimientos.json', [])

    loc_by_norm = {norm_key(l['nombre']): l for l in localidades if l.get('nombre')}
    next_loc_id = max((int(l.get('id', 0)) for l in localidades), default=0) + 1

    persona_by_code = {str(p['codigo_interno']).upper(): p for p in personas if p.get('codigo_interno')}
    persona_by_name_loc = {
        (norm_key(p.get('nombre')), norm_key(p.get('apellido')), norm_key(p.get('localidad_nombre'))): p
        for p in personas
    }
    next_persona_id = max((int(p.get('id', 0)) for p in personas), default=0) + 1
    max_code_num = 0
    for p in personas:
        m = re.match(r'^SC-(\d+)$', str(p.get('codigo_interno', '')).upper())
        if m:
            max_code_num = max(max_code_num, int(m.group(1)))

    seg_keys = {
        (
            s.get('persona_id'),
            s.get('localidad_id'),
            str(s.get('fecha') or ''),
            str(s.get('tipo') or ''),
            norm_key(s.get('descripcion')),
        )
        for s in seguimientos
    }
    next_seg_id = max((int(s.get('id', 0)) for s in seguimientos), default=0) + 1

    stats = {
        'archivos': [],
        'fuentes': [],
        'archivos_requieren_revision': [],
        'localidades_agregadas': 0,
        'localidades_actualizadas': 0,
        'personas_agregadas': 0,
        'personas_actualizadas': 0,
        'personas_protegidas_mas_reciente': 0,
        'seguimientos_agregados': 0,
    }

    def ensure_localidad(nombre_raw: str, file_date: str | None = None, rel_source: str = '') -> dict | None:
        nonlocal next_loc_id
        nombre = nombre_raw.strip()
        if not nombre:
            return None
        key = norm_key(nombre)
        if key in loc_by_norm:
            return loc_by_norm[key]
        new_loc = {
            'id': next_loc_id,
            'nombre': nombre,
            'region': 'Región de Los Lagos',
            'descripcion': '',
            'latitud': None,
            'longitud': None,
            'activa': 1,
            'fecha_creacion': now,
            'fecha_actualizacion': now,
        }
        if file_date:
            new_loc['fecha_dato'] = file_date
        if rel_source:
            new_loc['archivo_fuente'] = rel_source
        next_loc_id += 1
        localidades.append(new_loc)
        loc_by_norm[key] = new_loc
        stats['localidades_agregadas'] += 1
        return new_loc

    all_paths = [
        p
        for p in excel_dir.rglob('*')
        if p.is_file()
        and not p.name.startswith('~$')
        and not p.name.startswith('.')
        and p.name != 'README.md'
        and '__pycache__' not in p.parts
    ]

    process_entries: list[tuple[str, float, str, pathlib.Path, str]] = []
    for p in all_paths:
        rel_name = p.relative_to(excel_dir).as_posix()
        ext = p.suffix.lower()
        file_date, date_origin = extract_delivery_date(p, excel_dir)
        mtime = p.stat().st_mtime
        if ext in REVIEW_REQUIRED_EXTS:
            stats['archivos_requieren_revision'].append(
                {
                    'archivo': rel_name,
                    'fecha_entrega': file_date,
                    'formato': ext,
                    'motivo': 'Formato visual/binario: requiere transcripción o extracción asistida para integrarlo al JSON.',
                }
            )
            continue
        if ext in SUPPORTED_DATA_EXTS:
            # Procesar plantilla vacía primero sin alterar orden de datos reales
            sort_date = '0000-01-01' if p.name == 'plantilla_senasconecta.xlsx' else file_date
            process_entries.append((sort_date, mtime, rel_name, p, f'{file_date}|{date_origin}'))

    # Orden estricto del más antiguo al más reciente: así el archivo más reciente siempre prevalece
    process_entries.sort(key=lambda item: (item[0], item[1], item[2]))

    for _sort_date, _mtime, rel_name, src_path, date_meta in process_entries:
        file_date, date_origin = date_meta.split('|', 1)
        stats['archivos'].append(rel_name)
        sheet_batches = read_any_source_sheets(src_path)

        has_real_rows = False
        deferred_batches: list[tuple[str, str, set[str], list[dict[str, str]]]] = []

        # 1. Localidades explícitas del archivo actual
        for sname, rows in sheet_batches:
            headers, dicts = rows_to_dicts(rows)
            if not dicts:
                continue
            has_real_rows = True
            kind = detect_sheet_kind(sname, headers)
            if kind == 'localidades':
                for row in dicts:
                    nombre = pick(row, 'nombre', 'localidad', 'nombre_localidad')
                    if not nombre:
                        continue
                    key = norm_key(nombre)
                    existing = loc_by_norm.get(key)
                    effective_date = parse_date(pick(row, 'fecha_entrega', 'fecha_archivo', 'fecha_dato')) or file_date
                    region = pick(row, 'region', 'zona')
                    desc = pick(row, 'descripcion', 'notas')
                    lat = parse_float_or_none(pick(row, 'latitud', 'lat'))
                    lng = parse_float_or_none(pick(row, 'longitud', 'lng', 'lon'))
                    activa_val = parse_tri_bool(pick(row, 'activa', 'activo', 'estado'))
                    if existing:
                        prev_date = str(existing.get('fecha_dato') or '')
                        if prev_date and effective_date < prev_date:
                            continue
                        if region:
                            existing['region'] = region
                        if desc:
                            existing['descripcion'] = desc
                        if lat is not None:
                            existing['latitud'] = lat
                        if lng is not None:
                            existing['longitud'] = lng
                        if activa_val is not None:
                            existing['activa'] = activa_val
                        existing['fecha_dato'] = effective_date
                        existing['archivo_fuente'] = rel_name
                        existing['fecha_actualizacion'] = now
                        stats['localidades_actualizadas'] += 1
                    else:
                        loc = {
                            'id': next_loc_id,
                            'nombre': nombre,
                            'region': region or 'Región de Los Lagos',
                            'descripcion': desc,
                            'latitud': lat,
                            'longitud': lng,
                            'activa': 1 if activa_val is None else activa_val,
                            'fecha_dato': effective_date,
                            'archivo_fuente': rel_name,
                            'fecha_creacion': now,
                            'fecha_actualizacion': now,
                        }
                        next_loc_id += 1
                        localidades.append(loc)
                        loc_by_norm[key] = loc
                        stats['localidades_agregadas'] += 1
            else:
                deferred_batches.append((kind, sname, headers, dicts))

        if has_real_rows or src_path.name != 'plantilla_senasconecta.xlsx':
            stats['fuentes'].append(
                {
                    'archivo': rel_name,
                    'fecha_entrega': file_date,
                    'origen_fecha': date_origin,
                    'formato': src_path.suffix.lower(),
                }
            )

        # 2. Personas del archivo actual
        for kind, _sname, headers, dicts in deferred_batches:
            if kind != 'personas':
                continue
            has_apellido_col = 'apellido' in headers or 'apellidos' in headers
            for row in dicts:
                raw_nombre = pick(row, 'nombre', 'nombres', 'persona')
                if not raw_nombre:
                    continue
                apellido = pick(row, 'apellido', 'apellidos')
                if not apellido and not has_apellido_col and ' ' in raw_nombre.strip():
                    parts = raw_nombre.strip().split(None, 1)
                    nombre, apellido = parts[0], parts[1]
                else:
                    nombre = raw_nombre.strip()

                effective_date = parse_date(pick(row, 'fecha_entrega', 'fecha_archivo', 'fecha_dato')) or file_date
                loc_name = pick(row, 'localidad', 'comuna', 'ciudad')
                loc_obj = ensure_localidad(loc_name, effective_date, rel_name) if loc_name else None

                raw_code = pick(row, 'codigo_interno', 'codigo', 'cod', 'id_interno').upper()
                existing = persona_by_code.get(raw_code) if raw_code else None
                if not existing:
                    existing = persona_by_name_loc.get(
                        (norm_key(nombre), norm_key(apellido), norm_key(loc_obj['nombre'] if loc_obj else loc_name))
                    )
                if not existing and loc_name:
                    existing = persona_by_name_loc.get((norm_key(nombre), norm_key(apellido), ''))

                if existing:
                    prev_date = str(existing.get('fecha_dato') or '')
                    if prev_date and effective_date < prev_date:
                        stats['personas_protegidas_mas_reciente'] += 1
                        continue

                usa_lsch = parse_tri_bool(pick(row, 'usa_lsch', 'utiliza_lsch', 'lsch'))
                raw_medio = pick(row, 'medio_comunicacion', 'medio', 'medio_preferido', 'comunicacion')
                medio = map_category(raw_medio, MEDIO_MAP, 'lsch' if usa_lsch == 1 else '')
                raw_nivel = pick(row, 'nivel_lsch', 'nivel')
                nivel = map_category(raw_nivel, NIVEL_LSCH_MAP, 'no_aplica' if usa_lsch == 0 else '')
                pref_esc = parse_tri_bool(pick(row, 'prefiere_escrita', 'comunicacion_escrita', 'escrita'))
                nec_int = parse_tri_bool(pick(row, 'necesita_interpretacion', 'requiere_interpretacion', 'interpretacion'))
                raw_estado = pick(row, 'estado', 'estado_registro')
                estado = map_category(raw_estado, ESTADO_REGISTRO_MAP, '')
                consent = parse_tri_bool(pick(row, 'consentimiento_registrado', 'consentimiento'))

                incoming = {
                    'nombre': nombre,
                    'apellido': apellido,
                    'localidad_id': loc_obj['id'] if loc_obj else None,
                    'localidad_nombre': loc_obj['nombre'] if loc_obj else '',
                    'sector': pick(row, 'sector', 'sector_o_barrio', 'barrio', 'zona', 'direccion_referencial'),
                    'fecha_incorporacion': parse_date(
                        pick(row, 'fecha_incorporacion', 'incorporacion', 'fecha_ingreso', 'fecha_registro')
                    ),
                    'medio_comunicacion': medio,
                    'usa_lsch': usa_lsch,
                    'nivel_lsch': nivel,
                    'prefiere_escrita': pref_esc,
                    'necesita_interpretacion': nec_int,
                    'observaciones_comunicacion': pick(row, 'observaciones_comunicacion', 'notas_comunicacion'),
                    'estado': estado,
                    'fecha_ultima_visita': parse_date(
                        pick(row, 'fecha_ultima_visita', 'ultima_visita', 'fecha_visita')
                    ),
                    'proxima_accion': pick(row, 'proxima_accion', 'accion_pendiente'),
                    'observaciones': pick(row, 'observaciones', 'notas', 'comentarios'),
                    'consentimiento_registrado': consent,
                    'nota_consentimiento': pick(row, 'nota_consentimiento'),
                }

                if existing:
                    # Actualización no destructiva: aplica solo campos informados en la entrega más reciente
                    old_loc_key = (
                        norm_key(existing.get('nombre')),
                        norm_key(existing.get('apellido')),
                        norm_key(existing.get('localidad_nombre')),
                    )
                    for k, val in incoming.items():
                        if val is not None and val != '':
                            existing[k] = val
                    if existing.get('consentimiento_registrado') is None:
                        existing['consentimiento_registrado'] = 1
                    if not existing.get('estado'):
                        existing['estado'] = 'por_confirmar'
                    existing['fecha_dato'] = effective_date
                    existing['archivo_fuente'] = rel_name
                    existing['fecha_actualizacion'] = now
                    new_loc_key = (
                        norm_key(existing.get('nombre')),
                        norm_key(existing.get('apellido')),
                        norm_key(existing.get('localidad_nombre')),
                    )
                    if old_loc_key != new_loc_key:
                        persona_by_name_loc.pop(old_loc_key, None)
                    persona_by_name_loc[new_loc_key] = existing
                    stats['personas_actualizadas'] += 1
                else:
                    if raw_code:
                        code = raw_code
                        m_num = re.match(r'^SC-(\d+)$', raw_code)
                        if m_num:
                            max_code_num = max(max_code_num, int(m_num.group(1)))
                    else:
                        max_code_num += 1
                        code = f'SC-{max_code_num:04d}'

                    person = {
                        'id': next_persona_id,
                        'codigo_interno': code,
                        'nombre': incoming['nombre'],
                        'apellido': incoming['apellido'],
                        'localidad_id': incoming['localidad_id'],
                        'localidad_nombre': incoming['localidad_nombre'],
                        'sector': incoming['sector'],
                        'fecha_incorporacion': incoming['fecha_incorporacion'],
                        'medio_comunicacion': incoming['medio_comunicacion'],
                        'usa_lsch': incoming['usa_lsch'],
                        'nivel_lsch': incoming['nivel_lsch'],
                        'prefiere_escrita': incoming['prefiere_escrita'],
                        'necesita_interpretacion': incoming['necesita_interpretacion'],
                        'observaciones_comunicacion': incoming['observaciones_comunicacion'],
                        'estado': incoming['estado'] or 'por_confirmar',
                        'fecha_ultima_visita': incoming['fecha_ultima_visita'],
                        'proxima_accion': incoming['proxima_accion'],
                        'observaciones': incoming['observaciones'],
                        'consentimiento_registrado': 0 if consent == 0 else 1,
                        'nota_consentimiento': incoming['nota_consentimiento'],
                        'fecha_consentimiento': now if consent != 0 else None,
                        'fecha_dato': effective_date,
                        'archivo_fuente': rel_name,
                        'fecha_creacion': now,
                        'fecha_actualizacion': now,
                    }
                    next_persona_id += 1
                    personas.append(person)
                    persona_by_code[code] = person
                    persona_by_name_loc[
                        (norm_key(person['nombre']), norm_key(person['apellido']), norm_key(person['localidad_nombre']))
                    ] = person
                    stats['personas_agregadas'] += 1

        # 3. Seguimientos del archivo actual
        persona_by_fullname = {
            norm_key(f"{p.get('nombre', '')} {p.get('apellido', '')}"): p for p in personas
        }
        for kind, _sname, _headers, dicts in deferred_batches:
            if kind != 'seguimientos':
                continue
            for row in dicts:
                desc = pick(row, 'descripcion', 'observaciones', 'notas')
                if not desc:
                    continue
                effective_date = parse_date(pick(row, 'fecha_entrega', 'fecha_archivo', 'fecha_dato')) or file_date
                raw_code = pick(row, 'codigo_persona', 'codigo', 'persona_codigo').upper()
                raw_pname = pick(row, 'nombre_persona', 'persona', 'nombre')
                p_obj = persona_by_code.get(raw_code) if raw_code else None
                if not p_obj and raw_pname:
                    p_obj = persona_by_fullname.get(norm_key(raw_pname))

                loc_name = pick(row, 'localidad', 'comuna')
                loc_obj = ensure_localidad(loc_name, effective_date, rel_name) if loc_name else None
                loc_id = loc_obj['id'] if loc_obj else (p_obj['localidad_id'] if p_obj else None)

                tipo = map_category(pick(row, 'tipo', 'tipo_seguimiento'), TIPO_SEG_MAP, 'visita_pendiente')
                estado = map_category(pick(row, 'estado', 'estado_seguimiento'), ESTADO_SEG_MAP, 'pendiente')
                fecha = parse_date(pick(row, 'fecha')) or effective_date

                dedup_key = (p_obj['id'] if p_obj else None, loc_id, fecha, tipo, norm_key(desc))
                if dedup_key in seg_keys:
                    continue
                seg_keys.add(dedup_key)
                seguimientos.append(
                    {
                        'id': next_seg_id,
                        'persona_id': p_obj['id'] if p_obj else None,
                        'localidad_id': loc_id,
                        'tipo': tipo,
                        'estado': estado,
                        'fecha': fecha,
                        'descripcion': desc,
                        'fecha_dato': effective_date,
                        'archivo_fuente': rel_name,
                        'fecha_creacion': now,
                        'fecha_actualizacion': now,
                    }
                )
                next_seg_id += 1
                stats['seguimientos_agregados'] += 1

    fuentes_desc = sorted(stats['fuentes'], key=lambda f: (f['fecha_entrega'], f['archivo']), reverse=True)
    meta = {
        'app': 'senasconecta',
        'grupo': 'Grupo Señas Osorno',
        'ultima_actualizacion': now,
        'fuentes_excel': [f['archivo'] for f in fuentes_desc] if fuentes_desc else stats['archivos'],
        'fuentes': fuentes_desc,
        'archivos_requieren_revision': stats['archivos_requieren_revision'],
        'totales': {
            'localidades': len(localidades),
            'personas': len(personas),
            'seguimientos': len(seguimientos),
        },
    }

    (data_dir / 'categorias.json').write_text(json.dumps(SEED_CATEGORIAS, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (data_dir / 'localidades.json').write_text(json.dumps(localidades, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (data_dir / 'personas.json').write_text(json.dumps(personas, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (data_dir / 'seguimientos.json').write_text(json.dumps(seguimientos, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (data_dir / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Integra archivos recibidos desde datos_excel/ hacia frontend/data/*.json priorizando los más recientes.'
    )
    parser.add_argument('--excel-dir', type=pathlib.Path, default=EXCEL_DIR)
    parser.add_argument('--data-dir', type=pathlib.Path, default=DATA_DIR)
    parser.add_argument('--replace', action='store_true', help='Reemplaza personas y seguimientos con el contenido actual de datos_excel/')
    parser.add_argument('--crear-plantilla', action='store_true', help='Crea/regenera plantilla_senasconecta.xlsx en datos_excel/')
    args = parser.parse_args()

    if args.crear_plantilla or not (args.excel_dir / 'plantilla_senasconecta.xlsx').exists():
        tpl = create_excel_template(args.excel_dir)
        print(f'Plantilla Excel disponible en: {tpl}')

    res = sync_excel_to_json(args.excel_dir, args.data_dir, replace=args.replace)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
