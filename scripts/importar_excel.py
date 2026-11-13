#!/usr/bin/env python3
"""Importa planillas Excel (.xlsx) y CSV desde datos_excel/ a la base JSON en frontend/data/.

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
        'nombre': 'Purranque',
        'region': 'Región de Los Lagos',
        'descripcion': 'Localidad urbana y localidades vecinas del sur provincial.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
    {
        'id': 4,
        'nombre': 'Puerto Octay',
        'region': 'Región de Los Lagos',
        'descripcion': 'Sector lacustre y áreas rurales cercanas.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
    {
        'id': 5,
        'nombre': 'San Pablo',
        'region': 'Región de Los Lagos',
        'descripcion': 'Localidad del sector norte provincial.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
    {
        'id': 6,
        'nombre': 'Puyehue',
        'region': 'Región de Los Lagos',
        'descripcion': 'Entre Lagos y sectores cordilleranos de la comuna.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
    {
        'id': 7,
        'nombre': 'San Juan de la Costa',
        'region': 'Región de Los Lagos',
        'descripcion': 'Sectores costeros y comunidades rurales.',
        'latitud': None,
        'longitud': None,
        'activa': 1,
        'fecha_creacion': '2026-01-01T00:00:00.000Z',
        'fecha_actualizacion': '2026-01-01T00:00:00.000Z',
    },
    {
        'id': 8,
        'nombre': 'Río Bueno',
        'region': 'Región de Los Ríos',
        'descripcion': 'Localidad vecina con vinculación territorial.',
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


def read_csv_rows(path: pathlib.Path) -> list[list[str]]:
    raw = path.read_bytes()
    text = None
    for enc in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return []
    sample = '\n'.join(text.splitlines()[:5])
    delimiter = ','
    if sample.count(';') > sample.count(','):
        delimiter = ';'
    elif sample.count('\t') > sample.count(','):
        delimiter = '\t'
    reader = csv.reader(text.splitlines(), delimiter=delimiter)
    return [[cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)]


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
    m_iso = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m_iso:
        return f'{m_iso.group(1)}-{m_iso.group(2)}-{m_iso.group(3)}'
    m_lat = re.match(r'^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})', s)
    if m_lat:
        day, month, year = int(m_lat.group(1)), int(m_lat.group(2)), int(m_lat.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f'{year:04d}-{month:02d}-{day:02d}'
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
        record = {}
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
    if 'nombre' in headers or 'personas' in s_norm:
        if 'region' in headers or 'latitud' in headers:
            if 'apellido' not in headers and 'sector' not in headers and 'estado' not in headers:
                return 'localidades'
        return 'personas'
    return 'unknown'


def pick(row: dict[str, str], *aliases: str) -> str:
    for key in aliases:
        if key in row and row[key] != '':
            return row[key]
    return ''


def ensure_seed_data_files(data_dir: pathlib.Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    defaults: dict[str, object] = {
        'categorias.json': SEED_CATEGORIAS,
        'localidades.json': SEED_LOCALIDADES,
        'personas.json': [],
        'seguimientos.json': [],
        'meta.json': {
            'app': 'senasconecta',
            'grupo': 'Grupo Señas Osorno',
            'ultima_actualizacion': utc_now_iso(),
            'fuentes_excel': [],
        },
    }
    for filename, payload in defaults.items():
        target = data_dir / filename
        if not target.exists():
            target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def create_excel_template(excel_dir: pathlib.Path) -> pathlib.Path:
    template_path = excel_dir / 'plantilla_senasconecta.xlsx'
    write_xlsx_workbook(
        template_path,
        [
            ('Personas', [PERSON_TEMPLATE_HEADERS]),
            ('Localidades', [LOCALIDAD_TEMPLATE_HEADERS]),
            ('Seguimientos', [SEGUIMIENTO_TEMPLATE_HEADERS]),
        ],
    )
    return template_path


def load_json_list(path: pathlib.Path, fallback: list) -> list:
    if not path.is_file():
        return [dict(item) for item in fallback]
    data = json.loads(path.read_text(encoding='utf-8'))
    return data if isinstance(data, list) else [dict(item) for item in fallback]


def sync_excel_to_json(
    excel_dir: pathlib.Path = EXCEL_DIR,
    data_dir: pathlib.Path = DATA_DIR,
    replace: bool = False,
) -> dict[str, object]:
    ensure_seed_data_files(data_dir)
    excel_dir.mkdir(parents=True, exist_ok=True)

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
        'localidades_agregadas': 0,
        'localidades_actualizadas': 0,
        'personas_agregadas': 0,
        'personas_actualizadas': 0,
        'seguimientos_agregados': 0,
    }

    def ensure_localidad(nombre_raw: str) -> dict | None:
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
        next_loc_id += 1
        localidades.append(new_loc)
        loc_by_norm[key] = new_loc
        stats['localidades_agregadas'] += 1
        return new_loc

    xls_files = sorted(p for p in excel_dir.glob('*.xls') if not p.name.startswith('~$'))
    if xls_files:
        names = ', '.join(f.name for f in xls_files)
        raise RuntimeError(
            f'Se encontraron archivos .xls antiguos ({names}). Guárdalos en Excel como .xlsx o .csv en {excel_dir}.'
        )

    source_files = sorted(
        [
            p
            for p in excel_dir.iterdir()
            if p.is_file() and not p.name.startswith('~$') and p.suffix.lower() in ('.xlsx', '.csv')
        ]
    )

    sheet_batches: list[tuple[str, str, list[list[str]]]] = []
    for src_path in source_files:
        stats['archivos'].append(src_path.name)
        if src_path.suffix.lower() == '.xlsx':
            for sname, srows in read_xlsx_sheets(src_path):
                sheet_batches.append((src_path.name, sname, srows))
        else:
            sheet_batches.append((src_path.name, src_path.stem, read_csv_rows(src_path)))

    # 1. Procesar primero localidades explícitas
    deferred_batches: list[tuple[str, str, set[str], list[dict[str, str]]]] = []
    for _fname, sname, rows in sheet_batches:
        headers, dicts = rows_to_dicts(rows)
        if not dicts:
            continue
        kind = detect_sheet_kind(sname, headers)
        if kind == 'localidades':
            for row in dicts:
                nombre = pick(row, 'nombre', 'localidad', 'nombre_localidad')
                if not nombre:
                    continue
                key = norm_key(nombre)
                existing = loc_by_norm.get(key)
                region = pick(row, 'region', 'zona')
                desc = pick(row, 'descripcion', 'notas')
                lat = parse_float_or_none(pick(row, 'latitud', 'lat'))
                lng = parse_float_or_none(pick(row, 'longitud', 'lng', 'lon'))
                activa_val = parse_tri_bool(pick(row, 'activa', 'activo', 'estado'))
                if existing:
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
                        'fecha_creacion': now,
                        'fecha_actualizacion': now,
                    }
                    next_loc_id += 1
                    localidades.append(loc)
                    loc_by_norm[key] = loc
                    stats['localidades_agregadas'] += 1
        else:
            deferred_batches.append((kind, sname, headers, dicts))

    # 2. Procesar personas
    for kind, _sname, _headers, dicts in deferred_batches:
        if kind != 'personas':
            continue
        for row in dicts:
            nombre = pick(row, 'nombre', 'nombres')
            if not nombre:
                continue
            apellido = pick(row, 'apellido', 'apellidos')
            loc_name = pick(row, 'localidad', 'comuna', 'ciudad')
            loc_obj = ensure_localidad(loc_name) if loc_name else None

            raw_code = pick(row, 'codigo_interno', 'codigo', 'cod', 'id_interno').upper()
            existing = persona_by_code.get(raw_code) if raw_code else None
            if not existing:
                existing = persona_by_name_loc.get((norm_key(nombre), norm_key(apellido), norm_key(loc_obj['nombre'] if loc_obj else loc_name)))

            usa_lsch = parse_tri_bool(pick(row, 'usa_lsch', 'utiliza_lsch', 'lsch'))
            medio = map_category(
                pick(row, 'medio_comunicacion', 'medio', 'medio_preferido', 'comunicacion'),
                MEDIO_MAP,
                'lsch' if usa_lsch == 1 else '',
            )
            nivel = map_category(pick(row, 'nivel_lsch', 'nivel'), NIVEL_LSCH_MAP, 'no_aplica' if usa_lsch == 0 else '')
            pref_esc = parse_tri_bool(pick(row, 'prefiere_escrita', 'comunicacion_escrita', 'escrita'))
            nec_int = parse_tri_bool(pick(row, 'necesita_interpretacion', 'requiere_interpretacion', 'interpretacion'))
            estado = map_category(pick(row, 'estado', 'estado_registro'), ESTADO_REGISTRO_MAP, 'por_confirmar')
            consent = parse_tri_bool(pick(row, 'consentimiento_registrado', 'consentimiento'))

            fields = {
                'nombre': nombre,
                'apellido': apellido,
                'localidad_id': loc_obj['id'] if loc_obj else None,
                'localidad_nombre': loc_obj['nombre'] if loc_obj else '',
                'sector': pick(row, 'sector', 'sector_o_barrio', 'barrio', 'zona'),
                'fecha_incorporacion': parse_date(pick(row, 'fecha_incorporacion', 'incorporacion', 'fecha_ingreso', 'fecha_registro')),
                'medio_comunicacion': medio,
                'usa_lsch': usa_lsch,
                'nivel_lsch': nivel,
                'prefiere_escrita': pref_esc,
                'necesita_interpretacion': nec_int,
                'observaciones_comunicacion': pick(row, 'observaciones_comunicacion', 'notas_comunicacion'),
                'estado': estado,
                'fecha_ultima_visita': parse_date(pick(row, 'fecha_ultima_visita', 'ultima_visita', 'fecha_visita')),
                'proxima_accion': pick(row, 'proxima_accion', 'accion_pendiente'),
                'observaciones': pick(row, 'observaciones', 'notas', 'comentarios'),
                'consentimiento_registrado': 0 if consent == 0 else 1,
                'nota_consentimiento': pick(row, 'nota_consentimiento'),
            }

            if existing:
                existing.update(fields)
                existing['fecha_actualizacion'] = now
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
                    **fields,
                    'fecha_consentimiento': now if fields['consentimiento_registrado'] else None,
                    'fecha_creacion': now,
                    'fecha_actualizacion': now,
                }
                next_persona_id += 1
                personas.append(person)
                persona_by_code[code] = person
                persona_by_name_loc[(norm_key(nombre), norm_key(apellido), norm_key(fields['localidad_nombre']))] = person
                stats['personas_agregadas'] += 1

    # 3. Procesar seguimientos
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
            raw_code = pick(row, 'codigo_persona', 'codigo', 'persona_codigo').upper()
            raw_pname = pick(row, 'nombre_persona', 'persona', 'nombre')
            p_obj = persona_by_code.get(raw_code) if raw_code else None
            if not p_obj and raw_pname:
                p_obj = persona_by_fullname.get(norm_key(raw_pname))

            loc_name = pick(row, 'localidad', 'comuna')
            loc_obj = ensure_localidad(loc_name) if loc_name else None
            loc_id = loc_obj['id'] if loc_obj else (p_obj['localidad_id'] if p_obj else None)

            tipo = map_category(pick(row, 'tipo', 'tipo_seguimiento'), TIPO_SEG_MAP, 'visita_pendiente')
            estado = map_category(pick(row, 'estado', 'estado_seguimiento'), ESTADO_SEG_MAP, 'pendiente')
            fecha = parse_date(pick(row, 'fecha')) or dt.date.today().isoformat()

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
                    'fecha_creacion': now,
                    'fecha_actualizacion': now,
                }
            )
            next_seg_id += 1
            stats['seguimientos_agregados'] += 1

    meta = {
        'app': 'senasconecta',
        'grupo': 'Grupo Señas Osorno',
        'ultima_actualizacion': now,
        'fuentes_excel': stats['archivos'],
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
        description='Integra archivos Excel (.xlsx/.csv) desde datos_excel/ hacia frontend/data/*.json.'
    )
    parser.add_argument('--excel-dir', type=pathlib.Path, default=EXCEL_DIR)
    parser.add_argument('--data-dir', type=pathlib.Path, default=DATA_DIR)
    parser.add_argument('--replace', action='store_true', help='Reemplaza personas y seguimientos con el contenido de los Excel')
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
