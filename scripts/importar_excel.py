#!/usr/bin/env python3
"""Integra archivos recibidos (.xlsx, .ods, .csv, .tsv, .json, .docx, .odt, .txt, .md, .kml, .kmz)
desde datos/ hacia la base JSON estática en frontend/data/, priorizando
siempre los archivos con fecha de entrega más reciente.

Sin dependencias externas: usa únicamente la biblioteca estándar de Python 3.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import pathlib
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from xml.sax.saxutils import escape

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
EXCEL_DIR = ROOT_DIR / 'datos'
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
    'Direccion',
    'Latitud',
    'Longitud',
    'Link Google Maps',
]

LOCALIDAD_TEMPLATE_HEADERS = [
    'Nombre',
    'Region',
    'Descripcion',
    'Latitud',
    'Longitud',
    'Activa',
]

SUPPORTED_DATA_EXTS = {'.xlsx', '.ods', '.csv', '.tsv', '.json', '.docx', '.odt', '.txt', '.md', '.kml', '.kmz'}
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
    'direccion': 'direccion',
    'domicilio': 'direccion',
    'calle': 'direccion',
    'latitud': 'latitud',
    'lat': 'latitud',
    'longitud': 'longitud',
    'lng': 'longitud',
    'lon': 'longitud',
    'link_google_maps': 'mapa_url',
    'google_maps': 'mapa_url',
    'enlace_google_maps': 'mapa_url',
    'enlace_mapa': 'mapa_url',
    'mapa_url': 'mapa_url',
    'url_mapa': 'mapa_url',
    'link_mapa': 'mapa_url',
    'ubicacion': 'ubicacion',
    'coordenadas': 'ubicacion',
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
    """Lee un archivo .json con lista de personas o estructura {localidades, personas}."""
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
        if raw_k in ('http', 'https') or m.group(2).lstrip().startswith('//'):
            continue
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


def _point_in_polygon(lat: float, lng: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _split_kml_person_name(raw_name: str) -> tuple[str, str, list[str]]:
    clean = re.sub(r'^\s*\d+\s*[-.–:]\s*', '', str(raw_name or '')).strip()
    extra_notes: list[str] = []

    def _collect_paren(m: re.Match[str]) -> str:
        inner = m.group(1).strip()
        if inner:
            extra_notes.append(inner)
        return ''

    clean = re.sub(r'\(([^)]+)\)', _collect_paren, clean).strip(' -')
    clean = re.sub(r'\s{2,}', ' ', clean)
    if not clean:
        return '', '', extra_notes

    # Nombres que son direcciones numéricas (ej. "Huechuraba 1621") o parejas ("Rut y Gustavo...") se mantienen completos en Nombre
    if re.search(r'\by\b', clean, re.IGNORECASE) or re.search(r'\d', clean):
        return clean, '', extra_notes

    parts = clean.split()
    if len(parts) == 1:
        return parts[0], '', extra_notes
    return parts[0], ' '.join(parts[1:]), extra_notes


def _clean_kml_description(raw_desc: str) -> tuple[str, str, str]:
    text = re.sub(r'<br\s*/?>', '\n', str(raw_desc or ''), flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
    text = html.unescape(re.sub(r'<[^>]+>', '', text))
    lines = [re.sub(r'\s+', ' ', ln).strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    if not lines:
        return '', '', ''

    ultima_visita = ''
    direccion = ''
    obs_parts: list[str] = []

    for ln in lines:
        m_fecha = re.search(r'(?:ultima\s+fecha|fecha\s+visita)\s*:\s*(.+)$', ln, re.IGNORECASE)
        if m_fecha:
            parsed_d = parse_date(m_fecha.group(1).strip())
            if parsed_d:
                ultima_visita = parsed_d
            else:
                obs_parts.append(ln)
            continue

        if ln.upper().startswith('NOTA:'):
            obs_parts.append(ln)
            continue

        if not direccion:
            # Si incluye número o calle o es frase corta sin exceder dirección típica, usar como dirección referencial
            if len(ln) <= 75 and ',' not in ln:
                direccion = ln
            else:
                obs_parts.append(ln)
        else:
            obs_parts.append(ln)

    return direccion, ' · '.join(obs_parts), ultima_visita


def _infer_kml_territory(
    lat: float,
    lng: float,
    polys: list[tuple[str, list[tuple[float, float]]]],
    text_hint: str,
) -> tuple[str, str]:
    hint_norm = norm_key(text_hint)
    for poly_name, ring in polys:
        if _point_in_polygon(lat, lng, ring):
            if '-' in poly_name:
                left, right = [part.strip() for part in poly_name.split('-', 1)]
                loc = re.sub(r'\s*\([^)]*\)\s*', '', right).strip()
                sec = re.sub(r'\s*\([^)]*\)\s*', '', left).strip()
                return loc, sec
            return re.sub(r'\s*\([^)]*\)\s*', '', poly_name).strip(), ''

    if lat <= -40.86:
        return 'Purranque', ''
    if -40.86 < lat <= -40.70:
        return 'Río Negro', 'Sector rural' if lng < -73.26 else ''
    if -40.66 <= lat <= -40.48 and -73.25 <= lng <= -73.02:
        sector = ''
        if 'ovejeria' in hint_norm or (lat <= -40.582 and -73.152 <= lng <= -73.135):
            sector = 'Ovejería'
        return 'Osorno', sector
    if -40.48 < lat <= -40.32 and lng <= -73.20:
        return 'San Pablo', ''
    return '', ''


def _read_kml_raw_bytes(path: pathlib.Path) -> bytes | None:
    ext = path.suffix.lower()
    if ext == '.kml':
        return path.read_bytes()
    if ext == '.kmz':
        with zipfile.ZipFile(path, 'r') as zf:
            kml_names = [n for n in zf.namelist() if n.lower().endswith('.kml')]
            if not kml_names:
                return None
            target = 'doc.kml' if 'doc.kml' in kml_names else kml_names[0]
            return zf.read(target)
    return None


def _is_kml_network_link(path: pathlib.Path) -> bool:
    raw = _read_kml_raw_bytes(path)
    if not raw:
        return False
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return False
    has_net = any(_tag_name(el) == 'NetworkLink' for el in root.iter())
    has_point_pm = any(
        _tag_name(el) == 'Placemark' and any(_tag_name(c) == 'Point' for c in el.iter())
        for el in root.iter()
    )
    return has_net and not has_point_pm


def read_kml_bytes_to_sheets(raw: bytes, default_name: str = 'Personas') -> list[tuple[str, list[list[str]]]]:
    """Extrae marcadores de puntos desde un archivo KML (Google My Maps / Google Earth)."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []

    doc_el = next((el for el in root.iter() if _tag_name(el) == 'Document'), root)

    def _find_child(parent: ET.Element, tag: str) -> ET.Element | None:
        return next((c for c in parent if _tag_name(c) == tag), None)

    def _child_text(parent: ET.Element, tag: str) -> str:
        ch = _find_child(parent, tag)
        return ''.join(ch.itertext()).strip() if ch is not None else ''

    # 1. Recolectar polígonos de límites territoriales si existen
    boundary_polys: list[tuple[str, list[tuple[float, float]]]] = []
    point_placemarks: list[tuple[str, ET.Element]] = []

    folders = [c for c in doc_el if _tag_name(c) == 'Folder']
    containers: list[tuple[str, ET.Element]] = (
        [(_child_text(f, 'name') or default_name, f) for f in folders]
        if folders
        else [(default_name, doc_el)]
    )

    for folder_name, container in containers:
        fn_norm = norm_key(folder_name)
        for pm in container.iter():
            if _tag_name(pm) != 'Placemark':
                continue
            pm_name = _child_text(pm, 'name')
            has_point = any(_tag_name(el) == 'Point' for el in pm.iter())
            has_poly = any(_tag_name(el) == 'Polygon' for el in pm.iter())

            is_date_label = bool(re.fullmatch(r'\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?', pm_name.strip()))
            is_boundary_folder = ('limite' in fn_norm or 'territorio' in fn_norm or 'congre' in fn_norm)
            is_survey_folder = 'encuesta' in fn_norm
            if has_poly and not is_survey_folder and not is_date_label and (is_boundary_folder or not folders):
                coord_el = next((el for el in pm.iter() if _tag_name(el) == 'coordinates'), None)
                if coord_el is not None and coord_el.text:
                    ring: list[tuple[float, float]] = []
                    for tok in coord_el.text.strip().split():
                        parts = tok.split(',')
                        if len(parts) >= 2:
                            p_lat = parse_float_or_none(parts[1])
                            p_lng = parse_float_or_none(parts[0])
                            v_lat, v_lng = valid_lat_lng(p_lat, p_lng)
                            if v_lat is not None and v_lng is not None:
                                ring.append((v_lat, v_lng))
                    if len(ring) >= 3:
                        boundary_polys.append((pm_name, ring))
            if has_point:
                point_placemarks.append((folder_name, pm))

    if not point_placemarks:
        return []

    headers = [
        'Nombre',
        'Apellido',
        'Localidad',
        'Sector',
        'Estado',
        'Ultima visita',
        'Observaciones',
        'Direccion',
        'Latitud',
        'Longitud',
        'Link Google Maps',
    ]
    rows: list[list[str]] = [headers]

    for folder_name, pm in point_placemarks:
        raw_name = _child_text(pm, 'name')
        raw_desc = _child_text(pm, 'description')
        style_url = _child_text(pm, 'styleUrl')

        pt_el = next((el for el in pm.iter() if _tag_name(el) == 'Point'), None)
        coord_el = _find_child(pt_el, 'coordinates') if pt_el is not None else None
        coord_txt = ''.join(coord_el.itertext()).strip() if coord_el is not None else ''
        coord_parts = [c.strip() for c in coord_txt.split(',')]
        if len(coord_parts) < 2:
            continue

        lat, lng = valid_lat_lng(parse_float_or_none(coord_parts[1]), parse_float_or_none(coord_parts[0]))
        if lat is None or lng is None:
            continue

        ext_map: dict[str, str] = {}
        ext_el = _find_child(pm, 'ExtendedData')
        if ext_el is not None:
            for d_el in ext_el.iter():
                if _tag_name(d_el) == 'Data':
                    k_ext = norm_key(d_el.attrib.get('name', ''))
                    v_ext = _child_text(d_el, 'value')
                    if k_ext and v_ext:
                        ext_map[k_ext] = v_ext

        nombre, apellido, paren_notes = _split_kml_person_name(raw_name)
        if not nombre:
            continue

        desc_dir, desc_obs, ultima_visita = _clean_kml_description(raw_desc)
        direccion = ext_map.get('direccion', '') or desc_dir
        if not direccion and re.search(r'\d', nombre):
            direccion = nombre

        notes_all = [*paren_notes]
        if desc_obs:
            notes_all.append(desc_obs)
        observaciones = ' · '.join(dict.fromkeys(notes_all))

        all_text_hint = f'{raw_name} {raw_desc} {folder_name}'
        is_no_pasar = ('no pasar' in norm_key(all_text_hint)) or ('#icon-1898-e65100' in style_url.lower())
        estado = ext_map.get('estado', '') or ('inactivo' if is_no_pasar else 'por_confirmar')

        localidad = ext_map.get('localidad', '')
        sector = ext_map.get('sector', '')
        if not localidad:
            inf_loc, inf_sec = _infer_kml_territory(lat, lng, boundary_polys, all_text_hint)
            localidad = inf_loc
            if not sector:
                sector = inf_sec

        maps_url = f'https://www.google.com/maps/search/?api=1&query={lat},{lng}'
        rows.append(
            [
                nombre,
                apellido,
                localidad,
                sector,
                estado,
                ultima_visita,
                observaciones,
                direccion,
                str(lat),
                str(lng),
                maps_url,
            ]
        )

    return [('Personas', rows)] if len(rows) > 1 else []


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
    if ext in ('.kml', '.kmz'):
        raw = _read_kml_raw_bytes(path)
        return read_kml_bytes_to_sheets(raw, path.stem) if raw else []
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
    m_lat = re.match(r'^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})', s)
    if m_lat:
        year = int(m_lat.group(3))
        if year < 100:
            year += 2000
        return _valid_iso_date(year, int(m_lat.group(2)), int(m_lat.group(1)))
    return None


def parse_float_or_none(val: object) -> float | None:
    s = str(val or '').strip().replace(',', '.')
    if not s:
        return None
    try:
        num = float(s)
    except ValueError:
        return None
    if num != num:  # NaN guard
        return None
    return num


def valid_lat_lng(lat: float | None, lng: float | None) -> tuple[float | None, float | None]:
    if lat is None or lng is None:
        return None, None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return None, None
    if lat == 0.0 and lng == 0.0:
        return None, None
    return round(lat, 6), round(lng, 6)


def safe_http_url(val: object) -> str:
    raw = str(val or '').strip()
    if re.match(r'^https?://\S+$', raw, re.IGNORECASE):
        return raw
    return ''


def parse_coordinates_text(val: object) -> tuple[float | None, float | None]:
    """Extrae (latitud, longitud) desde URLs de Google Maps o texto 'lat, lng'."""
    s = str(val or '').strip()
    if not s:
        return None, None

    patterns = [
        # Pin exacto embebido en enlaces largos de Google Maps (!3dLAT!4dLNG)
        r'!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)',
        # Parámetros query (?q=lat,lng, ll=lat,lng, center=lat,lng, query=lat%2Clng)
        r'[?&](?:q|query|ll|destination|center|saddr|daddr)=(-?\d+\.\d+)(?:,|%2C|\s+|\+)(-?\d+\.\d+)',
        # Vista @lat,lng,zoom
        r'@(-?\d+\.\d+),\s*(-?\d+\.\d+)',
        # Par directo con decimales: -40.5739, -73.1335
        r'^\s*(-?\d+\.\d+)\s*[,;\s]\s*(-?\d+\.\d+)\s*$',
    ]
    for pat in patterns:
        m = re.search(pat, s)
        if not m:
            continue
        lat, lng = valid_lat_lng(parse_float_or_none(m.group(1)), parse_float_or_none(m.group(2)))
        if lat is not None and lng is not None:
            return lat, lng
    return None, None


def extract_person_location(row: dict[str, str]) -> tuple[str, float | None, float | None, str]:
    raw_dir = pick(row, 'direccion', 'domicilio', 'calle')
    raw_map = pick(
        row,
        'mapa_url',
        'link_google_maps',
        'google_maps',
        'enlace_google_maps',
        'enlace_mapa',
        'url_mapa',
        'link_mapa',
    )
    raw_coord = pick(row, 'ubicacion', 'coordenadas')

    mapa_url = safe_http_url(raw_map) or safe_http_url(raw_coord)
    direccion = raw_dir
    if re.match(r'^https?://', raw_dir, re.IGNORECASE):
        if not mapa_url:
            mapa_url = safe_http_url(raw_dir)
        direccion = ''

    lat = parse_float_or_none(pick(row, 'latitud', 'lat'))
    lng = parse_float_or_none(pick(row, 'longitud', 'lng', 'lon'))
    lat, lng = valid_lat_lng(lat, lng)

    if lat is None or lng is None:
        for candidate in (raw_map, raw_coord, raw_dir):
            c_lat, c_lng = parse_coordinates_text(candidate)
            if c_lat is not None and c_lng is not None:
                lat, lng = c_lat, c_lng
                break

    return direccion, lat, lng, mapa_url


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
        return 'unknown'
    if 'nombre' in headers or 'nombres' in headers or 'persona' in headers or 'personas' in s_norm:
        person_only_cols = {
            'apellido',
            'apellidos',
            'sector',
            'estado',
            'localidad',
            'direccion',
            'domicilio',
            'mapa_url',
            'link_google_maps',
            'google_maps',
            'ubicacion',
            'usa_lsch',
            'medio_comunicacion',
        }
        if ('region' in headers or 'latitud' in headers or 'lat' in headers) and not (headers & person_only_cols):
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

    loc_by_norm = {norm_key(l['nombre']): l for l in localidades if l.get('nombre')}
    next_loc_id = max((int(l.get('id', 0)) for l in localidades), default=0) + 1

    persona_by_code = {str(p['codigo_interno']).upper(): p for p in personas if p.get('codigo_interno')}
    personas_by_name_loc: dict[tuple[str, str, str], list[dict]] = {}
    for p in personas:
        key = (norm_key(p.get('nombre')), norm_key(p.get('apellido')), norm_key(p.get('localidad_nombre')))
        personas_by_name_loc.setdefault(key, []).append(p)
    next_persona_id = max((int(p.get('id', 0)) for p in personas), default=0) + 1
    max_code_num = 0
    for p in personas:
        m = re.match(r'^SC-(\d+)$', str(p.get('codigo_interno', '')).upper())
        if m:
            max_code_num = max(max_code_num, int(m.group(1)))

    stats = {
        'archivos': [],
        'fuentes': [],
        'archivos_requieren_revision': [],
        'localidades_agregadas': 0,
        'localidades_actualizadas': 0,
        'personas_agregadas': 0,
        'personas_actualizadas': 0,
        'personas_protegidas_mas_reciente': 0,
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
        if not sheet_batches and src_path.suffix.lower() in ('.kml', '.kmz') and _is_kml_network_link(src_path):
            stats['archivos_requieren_revision'].append(
                {
                    'archivo': rel_name,
                    'fecha_entrega': file_date,
                    'formato': src_path.suffix.lower(),
                    'motivo': 'KMZ de enlace de red (NetworkLink) sin marcadores incrustados; exporta como .kml sin vínculo de red.',
                }
            )
            continue

        has_real_rows = False
        seen_in_file_ids: set[int] = set()
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
                resolved_loc_name = loc_obj['nombre'] if loc_obj else ''
                incoming_dir_probe, _lat_p, _lng_p, _map_p = extract_person_location(row)
                incoming_sector_probe = pick(row, 'sector', 'sector_o_barrio', 'barrio', 'zona', 'direccion_referencial')

                raw_code = pick(row, 'codigo_interno', 'codigo', 'cod', 'id_interno').upper()
                existing = persona_by_code.get(raw_code) if raw_code else None
                if not existing:
                    k_main = (norm_key(nombre), norm_key(apellido), norm_key(resolved_loc_name or loc_name))
                    candidates = list(personas_by_name_loc.get(k_main, []))
                    if loc_name:
                        candidates.extend(personas_by_name_loc.get((norm_key(nombre), norm_key(apellido), ''), []))
                    eligible = [c for c in candidates if int(c.get('id', 0)) not in seen_in_file_ids]
                    if len(eligible) == 1:
                        cand = eligible[0]
                        cand_dir_norm = norm_key(cand.get('direccion'))
                        inc_dir_norm = norm_key(incoming_dir_probe)
                        if apellido or not (cand_dir_norm and inc_dir_norm and cand_dir_norm != inc_dir_norm):
                            existing = cand
                    elif len(eligible) > 1:
                        inc_dir_norm = norm_key(incoming_dir_probe)
                        inc_sec_norm = norm_key(incoming_sector_probe)
                        if inc_dir_norm:
                            existing = next((c for c in eligible if norm_key(c.get('direccion')) == inc_dir_norm), None)
                        if not existing and inc_sec_norm:
                            existing = next((c for c in eligible if norm_key(c.get('sector')) == inc_sec_norm), None)
                        if not existing and apellido:
                            existing = eligible[0]

                if existing:
                    prev_date = str(existing.get('fecha_dato') or '')
                    if prev_date and effective_date < prev_date:
                        stats['personas_protegidas_mas_reciente'] += 1
                        seen_in_file_ids.add(int(existing.get('id', 0)))
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
                direccion, lat, lng, mapa_url = extract_person_location(row)

                incoming = {
                    'nombre': nombre,
                    'apellido': apellido,
                    'localidad_id': loc_obj['id'] if loc_obj else None,
                    'localidad_nombre': loc_obj['nombre'] if loc_obj else '',
                    'sector': pick(row, 'sector', 'sector_o_barrio', 'barrio', 'zona', 'direccion_referencial'),
                    'direccion': direccion,
                    'latitud': lat,
                    'longitud': lng,
                    'mapa_url': mapa_url,
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
                        old_list = personas_by_name_loc.get(old_loc_key, [])
                        if existing in old_list:
                            old_list.remove(existing)
                    new_list = personas_by_name_loc.setdefault(new_loc_key, [])
                    if existing not in new_list:
                        new_list.append(existing)
                    seen_in_file_ids.add(int(existing.get('id', 0)))
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
                        'direccion': incoming['direccion'],
                        'latitud': incoming['latitud'],
                        'longitud': incoming['longitud'],
                        'mapa_url': incoming['mapa_url'],
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
                    personas_by_name_loc.setdefault(
                        (norm_key(person['nombre']), norm_key(person['apellido']), norm_key(person['localidad_nombre'])),
                        [],
                    ).append(person)
                    seen_in_file_ids.add(int(person['id']))
                    stats['personas_agregadas'] += 1

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
        },
    }

    (data_dir / 'categorias.json').write_text(json.dumps(SEED_CATEGORIAS, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (data_dir / 'localidades.json').write_text(json.dumps(localidades, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (data_dir / 'personas.json').write_text(json.dumps(personas, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (data_dir / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Integra archivos recibidos desde datos/ hacia frontend/data/*.json priorizando los más recientes.'
    )
    parser.add_argument('--datos-dir', '--excel-dir', dest='excel_dir', type=pathlib.Path, default=EXCEL_DIR)
    parser.add_argument('--data-dir', type=pathlib.Path, default=DATA_DIR)
    parser.add_argument('--replace', action='store_true', help='Reemplaza personas con el contenido actual de datos/')
    parser.add_argument('--crear-plantilla', action='store_true', help='Crea/regenera plantilla_senasconecta.xlsx en datos/')
    args = parser.parse_args()

    if args.crear_plantilla or not (args.excel_dir / 'plantilla_senasconecta.xlsx').exists():
        tpl = create_excel_template(args.excel_dir)
        print(f'Plantilla Excel disponible en: {tpl}')

    res = sync_excel_to_json(args.excel_dir, args.data_dir, replace=args.replace)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
