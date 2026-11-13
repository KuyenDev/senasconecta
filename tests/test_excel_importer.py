"""Pruebas unitarias e integración para scripts/importar_excel.py."""

import json
import pathlib
import sys
import tempfile
import unittest

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR / 'scripts'))

import importar_excel  # noqa: E402


class ExcelImporterTests(unittest.TestCase):
    def test_01_template_generation_and_empty_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            excel_dir = tmp_path / 'datos_excel'
            data_dir = tmp_path / 'data'

            tpl_path = importar_excel.create_excel_template(excel_dir)
            self.assertTrue(tpl_path.exists())

            sheets = importar_excel.read_xlsx_sheets(tpl_path)
            sheet_names = [name for name, _ in sheets]
            self.assertEqual(sheet_names, ['Personas', 'Localidades', 'Seguimientos'])

            res = importar_excel.sync_excel_to_json(excel_dir, data_dir)
            self.assertEqual(res['personas_agregadas'], 0)
            self.assertEqual(res['seguimientos_agregados'], 0)

            localidades = json.loads((data_dir / 'localidades.json').read_text(encoding='utf-8'))
            personas = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            seguimientos = json.loads((data_dir / 'seguimientos.json').read_text(encoding='utf-8'))
            categorias = json.loads((data_dir / 'categorias.json').read_text(encoding='utf-8'))
            meta = json.loads((data_dir / 'meta.json').read_text(encoding='utf-8'))

            self.assertEqual(len(localidades), 3)
            self.assertEqual([l['nombre'] for l in localidades], ['Osorno', 'Río Negro', 'San Pablo'])
            self.assertEqual(personas, [])
            self.assertEqual(seguimientos, [])
            self.assertIn('estado_registro', categorias)
            self.assertEqual(meta['grupo'], 'Grupo Señas Osorno')
            self.assertEqual(meta['totales']['personas'], 0)

    def test_02_xlsx_multisheet_import_and_normalizations(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            excel_dir = tmp_path / 'datos_excel'
            data_dir = tmp_path / 'data'
            excel_dir.mkdir(parents=True, exist_ok=True)

            # Simular archivo temporal abierto por Excel que debe ignorarse
            (excel_dir / '~$registro.xlsx').write_text('lockfile', encoding='utf-8')

            wb_path = excel_dir / 'registro_osorno.xlsx'
            importar_excel.write_xlsx_workbook(
                wb_path,
                [
                    (
                        'Localidades',
                        [
                            importar_excel.LOCALIDAD_TEMPLATE_HEADERS,
                            ['Frutillar', 'Región de Los Lagos', 'Sector lacustre sur', -41.127, -73.06, 'Sí'],
                        ],
                    ),
                    (
                        'Personas',
                        [
                            importar_excel.PERSON_TEMPLATE_HEADERS,
                            [
                                '',
                                'Sofía',
                                'Cárdenas',
                                'Osorno',
                                'Rahue Bajo',
                                46053,  # Serial Excel -> 2026-01-31
                                'Lengua de Señas Chilena (LSCh)',
                                'Sí',
                                'Intermedio',
                                'No',
                                'Sí',
                                'Prefiere señas visuales',
                                'Confirmado',
                                '15/02/2026',
                                'Visitar en marzo',
                                'Registro inicial',
                            ],
                            [
                                'SC-0099',
                                'Mateo',
                                'Paredes',
                                'Entre Lagos',
                                'Centro',
                                '2026-03-01',
                                'Comunicación escrita',
                                'No',
                                '',
                                'Sí',
                                '',
                                '',
                                'Pendiente de actualización',
                                '',
                                '',
                                'Confirmar horario',
                            ],
                        ],
                    ),
                    (
                        'Seguimientos',
                        [
                            importar_excel.SEGUIMIENTO_TEMPLATE_HEADERS,
                            [
                                '',
                                'Sofía Cárdenas',
                                '',
                                '20/02/2026',
                                'Necesidad de interpretación',
                                'Pendiente',
                                'Coordinar intérprete para actividad',
                            ],
                            [
                                'SC-0099',
                                '',
                                'Entre Lagos',
                                '2026-03-05',
                                'Visita pendiente',
                                'En curso',
                                'Verificar dirección en Entre Lagos',
                            ],
                        ],
                    ),
                ],
            )

            stats = importar_excel.sync_excel_to_json(excel_dir, data_dir)
            self.assertEqual(stats['archivos'], ['registro_osorno.xlsx'])
            # Frutillar (desde hoja Localidades) + Entre Lagos (creada automáticamente desde Personas)
            self.assertEqual(stats['localidades_agregadas'], 2)
            self.assertEqual(stats['personas_agregadas'], 2)
            self.assertEqual(stats['seguimientos_agregados'], 2)

            localidades = json.loads((data_dir / 'localidades.json').read_text(encoding='utf-8'))
            personas = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            seguimientos = json.loads((data_dir / 'seguimientos.json').read_text(encoding='utf-8'))

            self.assertEqual(len(localidades), 5)
            frutillar = next(l for l in localidades if l['nombre'] == 'Frutillar')
            self.assertAlmostEqual(frutillar['latitud'], -41.127, places=3)
            self.assertEqual(frutillar['activa'], 1)

            sofia = next(p for p in personas if p['nombre'] == 'Sofía')
            self.assertEqual(sofia['codigo_interno'], 'SC-0001')
            self.assertEqual(sofia['fecha_incorporacion'], '2026-01-31')
            self.assertEqual(sofia['fecha_ultima_visita'], '2026-02-15')
            self.assertEqual(sofia['medio_comunicacion'], 'lsch')
            self.assertEqual(sofia['usa_lsch'], 1)
            self.assertEqual(sofia['prefiere_escrita'], 0)
            self.assertEqual(sofia['necesita_interpretacion'], 1)
            self.assertEqual(sofia['estado'], 'confirmado')

            mateo = next(p for p in personas if p['codigo_interno'] == 'SC-0099')
            self.assertEqual(mateo['localidad_nombre'], 'Entre Lagos')
            self.assertEqual(mateo['usa_lsch'], 0)
            self.assertEqual(mateo['nivel_lsch'], 'no_aplica')
            self.assertIsNone(mateo['necesita_interpretacion'])
            self.assertEqual(mateo['estado'], 'pendiente_actualizacion')

            self.assertEqual(seguimientos[0]['persona_id'], sofia['id'])
            self.assertEqual(seguimientos[0]['fecha'], '2026-02-20')
            self.assertEqual(seguimientos[0]['tipo'], 'necesidad_interpretacion')
            self.assertEqual(seguimientos[1]['persona_id'], mateo['id'])
            self.assertEqual(seguimientos[1]['estado'], 'en_curso')

    def test_03_csv_semicolon_idempotent_upsert_and_replace(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            excel_dir = tmp_path / 'datos_excel'
            data_dir = tmp_path / 'data'
            excel_dir.mkdir(parents=True, exist_ok=True)

            csv_path = excel_dir / 'personas_osorno.csv'
            csv_path.write_bytes(
                (
                    '\ufeffNombre;Apellido;Localidad;Sector;Usa LSCh;Estado\n'
                    'Elena;Vargas;Río Negro;Centro;Sí;Por confirmar\n'
                ).encode('utf-8')
            )

            s1 = importar_excel.sync_excel_to_json(excel_dir, data_dir)
            self.assertEqual(s1['personas_agregadas'], 1)

            # Segunda ejecución con actualización de fila existente -> no debe duplicar
            csv_path.write_bytes(
                (
                    '\ufeffNombre;Apellido;Localidad;Sector;Usa LSCh;Estado\n'
                    'Elena;Vargas;Río Negro;Norte;Sí;Confirmado\n'
                ).encode('utf-8')
            )
            s2 = importar_excel.sync_excel_to_json(excel_dir, data_dir)
            self.assertEqual(s2['personas_agregadas'], 0)
            self.assertEqual(s2['personas_actualizadas'], 1)

            personas = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            self.assertEqual(len(personas), 1)
            self.assertEqual(personas[0]['sector'], 'Norte')
            self.assertEqual(personas[0]['estado'], 'confirmado')

            # Reemplazo total con otra persona distinta
            csv_path.write_bytes(
                '\ufeffNombre;Apellido;Localidad;Estado\nLucas;Mora;Osorno;Confirmado\n'.encode('utf-8')
            )
            s3 = importar_excel.sync_excel_to_json(excel_dir, data_dir, replace=True)
            self.assertEqual(s3['personas_agregadas'], 1)
            personas_replaced = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            self.assertEqual([p['nombre'] for p in personas_replaced], ['Lucas'])


    def test_04_chronological_priority_ignores_alphabetical_and_protects_newer(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            excel_dir = tmp_path / 'datos_excel'
            data_dir = tmp_path / 'data'
            excel_dir.mkdir(parents=True, exist_ok=True)

            # Z aparece alfabéticamente después de A, pero tiene fecha más antigua (2026-10-01 vs 2026-11-12).
            csv_antiguo = (
                'Nombre;Apellido;Localidad;Sector;Nivel LSCh;Estado\n'
                'Elena;Castro;Osorno;Centro;Básico;Por confirmar\n'
            )
            csv_reciente = (
                'Nombre;Apellido;Localidad;Sector;Nivel LSCh;Estado\n'
                'Elena;Castro;Osorno;Rahue Bajo;Avanzado;Confirmado\n'
            )
            (excel_dir / '2026-10-01_zeta.csv').write_text(csv_antiguo, encoding='utf-8')
            (excel_dir / '2026-11-12_alfa.csv').write_text(csv_reciente, encoding='utf-8')

            res1 = importar_excel.sync_excel_to_json(excel_dir, data_dir, replace=True)
            self.assertEqual(res1['personas_agregadas'], 1)

            personas = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            elena = personas[0]
            self.assertEqual(elena['sector'], 'Rahue Bajo')
            self.assertEqual(elena['nivel_lsch'], 'avanzado')
            self.assertEqual(elena['estado'], 'confirmado')
            self.assertEqual(elena['fecha_dato'], '2026-11-12')
            self.assertEqual(elena['archivo_fuente'], '2026-11-12_alfa.csv')

            # Llega tarde un archivo más antiguo (2026-09-15) en ejecución incremental: no debe sobrescribir 2026-11-12
            csv_atrasado = (
                'Nombre;Apellido;Localidad;Sector;Nivel LSCh;Estado\n'
                'Elena;Castro;Osorno;Ovejería;Básico;Inactivo\n'
            )
            (excel_dir / '2026-09-15_antiguo.csv').write_text(csv_atrasado, encoding='utf-8')
            res2 = importar_excel.sync_excel_to_json(excel_dir, data_dir, replace=False)
            self.assertGreaterEqual(res2['personas_protegidas_mas_reciente'], 1)

            personas_after_old = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            elena_after_old = personas_after_old[0]
            self.assertEqual(elena_after_old['sector'], 'Rahue Bajo')
            self.assertEqual(elena_after_old['estado'], 'confirmado')
            self.assertEqual(elena_after_old['fecha_dato'], '2026-11-12')

            # Actualización parcial más reciente (2026-11-15 .txt): actualiza Sector, conserva Nivel LSCh y Estado previos
            txt_parcial = (
                'Nombre: Elena Castro\n'
                'Localidad: Osorno\n'
                'Sector: Francke\n'
            )
            (excel_dir / '2026-11-15_actualizacion.txt').write_text(txt_parcial, encoding='utf-8')
            res3 = importar_excel.sync_excel_to_json(excel_dir, data_dir, replace=False)
            self.assertGreaterEqual(res3['personas_actualizadas'], 1)

            personas_after_new = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            elena_final = personas_after_new[0]
            self.assertEqual(elena_final['sector'], 'Francke')
            self.assertEqual(elena_final['nivel_lsch'], 'avanzado')
            self.assertEqual(elena_final['estado'], 'confirmado')
            self.assertEqual(elena_final['fecha_dato'], '2026-11-15')
            self.assertEqual(elena_final['archivo_fuente'], '2026-11-15_actualizacion.txt')

    def test_05_non_excel_formats_txt_md_json_docx_ods_and_pdf_notice(self):
        import zipfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            excel_dir = tmp_path / 'datos_excel'
            data_dir = tmp_path / 'data'
            sub_dir = excel_dir / '2026-11-14'
            sub_dir.mkdir(parents=True, exist_ok=True)

            # 1. TXT en formato ficha
            (excel_dir / '2026-11-01_ficha.txt').write_text(
                'Nombre: Diego Morales\nLocalidad: Río Negro\nSector: Centro\nUsa LSCh: Sí\nEstado: Por confirmar\n',
                encoding='utf-8',
            )

            # 2. Markdown con tabla pipe
            (excel_dir / '05-11-2026_tabla.md').write_text(
                '# Listado\n\n'
                '| Nombre | Apellido | Localidad | Sector | Estado |\n'
                '| --- | --- | --- | --- | --- |\n'
                '| Lucía | Vega | San Pablo | Quilacahuín | Confirmado |\n',
                encoding='utf-8',
            )

            # 3. JSON estructurado con fecha posterior que actualiza a Diego
            (excel_dir / '2026-11-10_lote.json').write_text(
                json.dumps(
                    {
                        'personas': [
                            {
                                'Nombre': 'Diego',
                                'Apellido': 'Morales',
                                'Localidad': 'Río Negro',
                                'Sector': 'Chahuilco',
                                'Estado': 'Confirmado',
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding='utf-8',
            )

            # 4. DOCX mínimo (tabla Word)
            docx_path = excel_dir / '2026-11-12_word.docx'
            doc_xml = (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body><w:tbl>'
                '<w:tr>'
                '<w:tc><w:p><w:r><w:t>Nombre</w:t></w:r></w:p></w:tc>'
                '<w:tc><w:p><w:r><w:t>Apellido</w:t></w:r></w:p></w:tc>'
                '<w:tc><w:p><w:r><w:t>Localidad</w:t></w:r></w:p></w:tc>'
                '<w:tc><w:p><w:r><w:t>Medio comunicacion</w:t></w:r></w:p></w:tc>'
                '</w:tr>'
                '<w:tr>'
                '<w:tc><w:p><w:r><w:t>Tomás</w:t></w:r></w:p></w:tc>'
                '<w:tc><w:p><w:r><w:t>Paredes</w:t></w:r></w:p></w:tc>'
                '<w:tc><w:p><w:r><w:t>Osorno</w:t></w:r></w:p></w:tc>'
                '<w:tc><w:p><w:r><w:t>Escrito</w:t></w:r></w:p></w:tc>'
                '</w:tr>'
                '</w:tbl></w:body></w:document>'
            )
            with zipfile.ZipFile(docx_path, 'w') as zf:
                zf.writestr('word/document.xml', doc_xml)

            # 5. ODS mínimo dentro de subcarpeta con fecha 2026-11-14
            ods_path = sub_dir / 'planilla_calc.ods'
            ods_xml = (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<office:document-content '
                'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
                'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
                'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">'
                '<office:body><office:spreadsheet>'
                '<table:table table:name="Personas">'
                '<table:table-row>'
                '<table:table-cell><text:p>Nombre</text:p></table:table-cell>'
                '<table:table-cell><text:p>Apellido</text:p></table:table-cell>'
                '<table:table-cell><text:p>Localidad</text:p></table:table-cell>'
                '<table:table-cell><text:p>Sector</text:p></table:table-cell>'
                '</table:table-row>'
                '<table:table-row>'
                '<table:table-cell><text:p>Sofía</text:p></table:table-cell>'
                '<table:table-cell><text:p>Navarro</text:p></table:table-cell>'
                '<table:table-cell><text:p>Osorno</text:p></table:table-cell>'
                '<table:table-cell><text:p>Pilauco</text:p></table:table-cell>'
                '</table:table-row>'
                '</table:table>'
                '</office:spreadsheet></office:body></office:document-content>'
            )
            with zipfile.ZipFile(ods_path, 'w') as zf:
                zf.writestr('content.xml', ods_xml)

            # 6. PDF sin texto estructurado: debe registrarse para revisión sin romper
            (sub_dir / 'escaneo_visitas.pdf').write_bytes(b'%PDF-1.4\n%stub\n')

            res = importar_excel.sync_excel_to_json(excel_dir, data_dir, replace=True)
            self.assertEqual(res['personas_agregadas'], 4)
            self.assertEqual(len(res['archivos_requieren_revision']), 1)

            personas = json.loads((data_dir / 'personas.json').read_text(encoding='utf-8'))
            por_nombre = {(p['nombre'], p['apellido']): p for p in personas}
            self.assertEqual(por_nombre[('Diego', 'Morales')]['sector'], 'Chahuilco')
            self.assertEqual(por_nombre[('Diego', 'Morales')]['fecha_dato'], '2026-11-10')
            self.assertEqual(por_nombre[('Lucía', 'Vega')]['fecha_dato'], '2026-11-05')
            self.assertEqual(por_nombre[('Tomás', 'Paredes')]['medio_comunicacion'], 'escrito')
            self.assertEqual(por_nombre[('Sofía', 'Navarro')]['sector'], 'Pilauco')
            self.assertEqual(por_nombre[('Sofía', 'Navarro')]['fecha_dato'], '2026-11-14')

            meta = json.loads((data_dir / 'meta.json').read_text(encoding='utf-8'))
            self.assertEqual(meta['fuentes'][0]['fecha_entrega'], '2026-11-14')
            self.assertEqual(meta['archivos_requieren_revision'][0]['archivo'], '2026-11-14/escaneo_visitas.pdf')


if __name__ == '__main__':
    unittest.main(verbosity=2)

