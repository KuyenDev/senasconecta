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


if __name__ == '__main__':
    unittest.main(verbosity=2)

