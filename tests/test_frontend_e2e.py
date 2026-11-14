"""Pruebas End-to-End del frontend estático de SeñasConecta sobre HTTP real."""

import base64
import functools
import http.server
import os
import pathlib
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
import zipfile

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / 'frontend'
RUNNER = ROOT_DIR / 'tests' / 'harness' / 'frontend_e2e_runner.mjs'
sys.path.insert(0, str(ROOT_DIR / 'scripts'))

import importar_excel  # noqa: E402


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def serve_directory(directory: pathlib.Path):
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


class FrontendStaticE2ETests(unittest.TestCase):
    def _run_e2e(self, scenario: str, base_url: str, initial_href: str) -> str:
        env = os.environ.copy()
        env.update(
            {
                'FRONTEND_URL': base_url,
                'TEST_SCENARIO': scenario,
                'INITIAL_HREF': initial_href,
            }
        )
        proc = subprocess.run(['gjs', '-m', str(RUNNER)], env=env, capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, f'Scenario {scenario} failed:\nSTDOUT:{proc.stdout}\nSTDERR:{proc.stderr}')
        return proc.stdout

    def test_01_empty_published_site_via_http(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            empty_site = tmp_path / 'site_empty'
            shutil.copytree(FRONTEND_DIR, empty_site)
            empty_datos = tmp_path / 'datos_vacios'
            empty_datos.mkdir(parents=True, exist_ok=True)
            importar_excel.sync_excel_to_json(empty_datos, empty_site / 'data', replace=True)

            server, port = serve_directory(empty_site)
            try:
                url = f'http://127.0.0.1:{port}'
                out = self._run_e2e('empty_published', url, f'{url}/index.html#dashboard')
                self.assertIn('E2E_EMPTY_PUBLISHED_OK', out)
            finally:
                server.shutdown()
                server.server_close()

    def _decode_xlsx_from_stdout(self, stdout: str, marker: str, dest_path: pathlib.Path) -> dict[str, list[list[str]]]:
        line = next((ln for ln in stdout.splitlines() if ln.startswith(f'{marker}:')), None)
        self.assertIsNotNone(line, f'Falta marcador {marker} en salida E2E')
        raw_bytes = base64.b64decode(line.split(':', 1)[1].strip())
        self.assertTrue(raw_bytes.startswith(b'PK\x03\x04'), f'{marker} no es ZIP/XLSX válido')
        dest_path.write_bytes(raw_bytes)
        with zipfile.ZipFile(dest_path, 'r') as zf:
            bad = zf.testzip()
            self.assertIsNone(bad, f'Archivo corrupto dentro de {marker}: {bad}')
        return dict(importar_excel.read_xlsx_sheets(dest_path))

    def test_03_real_published_site_with_kml_markers(self):
        server, port = serve_directory(FRONTEND_DIR)
        try:
            url = f'http://127.0.0.1:{port}'
            with urllib.request.urlopen(f'{url}/manifest.webmanifest', timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                manifest_raw = resp.read().decode('utf-8')
                self.assertIn('"standalone"', manifest_raw)
            with urllib.request.urlopen(f'{url}/sw.js', timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                sw_raw = resp.read().decode('utf-8')
                self.assertIn('senasconecta-shell-', sw_raw)
            with urllib.request.urlopen(f'{url}/assets/icon-192.png', timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                self.assertTrue(resp.read().startswith(b'\x89PNG\r\n\x1a\n'))

            out = self._run_e2e('live_published', url, f'{url}/index.html#dashboard')
            self.assertIn('E2E_LIVE_PUBLISHED_OK', out)
            with tempfile.TemporaryDirectory() as tmp:
                sheets = self._decode_xlsx_from_stdout(
                    out,
                    'XLSX_LIVE_SIMPLE_B64',
                    pathlib.Path(tmp) / 'live_simple.xlsx',
                )
                self.assertIn('Personas', sheets)
                rows = sheets['Personas']
                self.assertGreaterEqual(len(rows), 2)
                self.assertEqual(rows[0][0], 'Nombre')
                self.assertTrue(any('Eduardo Javier' in (row[0] if row else '') for row in rows[1:]))
        finally:
            server.shutdown()
            server.server_close()

    def test_02_excel_populated_site_under_github_pages_subpath(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            web_root = tmp_path / 'gh_pages_root'
            subpath_site = web_root / 'senasconecta'
            shutil.copytree(FRONTEND_DIR, subpath_site)

            excel_dir = tmp_path / 'datos'
            excel_dir.mkdir(parents=True, exist_ok=True)
            importar_excel.write_xlsx_workbook(
                excel_dir / 'datos_grupo.xlsx',
                [
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
                                '2026-02-01',
                                'Lengua de Señas Chilena (LSCh)',
                                'Sí',
                                'Avanzado',
                                'No',
                                'Sí',
                                'Prefiere señas',
                                'Confirmado',
                                '2026-02-15',
                                'Visitar en marzo',
                                '=SUM(A1)',
                                'Av. República 410',
                                -40.573912,
                                -73.133541,
                                'https://www.google.com/maps?q=-40.573912,-73.133541',
                            ],
                            [
                                '',
                                'Mateo',
                                'Paredes',
                                'Río Negro',
                                'Centro',
                                '2026-02-10',
                                'Comunicación escrita',
                                'No',
                                '',
                                'Sí',
                                'No',
                                '',
                                'Por confirmar',
                                '',
                                '',
                                'Confirmar disponibilidad',
                            ],
                        ],
                    ),
                ],
            )
            importar_excel.sync_excel_to_json(excel_dir, subpath_site / 'data', replace=True)

            server, port = serve_directory(web_root)
            try:
                base_url = f'http://127.0.0.1:{port}/senasconecta'
                out = self._run_e2e('excel_populated', base_url, f'{base_url}/#dashboard')
                self.assertIn('E2E_EXCEL_POPULATED_OK', out)

                expected_simple_headers = [
                    'Nombre',
                    'Localidad',
                    'Sector',
                    'Calle / Dirección',
                    'Usa LSCh',
                    'Medio de comunicación',
                    'Necesita interpretación',
                    'Estado',
                    'Notas',
                    'Google Maps',
                ]

                filtered_sheets = self._decode_xlsx_from_stdout(
                    out,
                    'XLSX_FILTERED_SIMPLE_B64',
                    tmp_path / 'filtered_simple.xlsx',
                )
                self.assertEqual(list(filtered_sheets.keys()), ['Personas'])
                self.assertEqual(filtered_sheets['Personas'][0], expected_simple_headers)
                self.assertEqual(len(filtered_sheets['Personas']), 2)
                self.assertEqual(filtered_sheets['Personas'][1][0], 'Sofía Cárdenas')
                self.assertEqual(filtered_sheets['Personas'][1][3], 'Av. República 410')
                self.assertEqual(filtered_sheets['Personas'][1][4], 'Sí')
                self.assertEqual(filtered_sheets['Personas'][1][8], '=SUM(A1)')

                full_simple_sheets = self._decode_xlsx_from_stdout(
                    out,
                    'XLSX_FULL_SIMPLE_B64',
                    tmp_path / 'full_simple.xlsx',
                )
                self.assertEqual(full_simple_sheets['Personas'][0], expected_simple_headers)
                self.assertEqual(len(full_simple_sheets['Personas']), 3)
                self.assertEqual(full_simple_sheets['Personas'][1][1], 'Osorno')
                self.assertEqual(full_simple_sheets['Personas'][2][1], 'Río Negro')

                complete_sheets = self._decode_xlsx_from_stdout(
                    out,
                    'XLSX_COMPLETE_B64',
                    tmp_path / 'complete_export.xlsx',
                )
                self.assertIn('Personas', complete_sheets)
                self.assertIn('Localidades', complete_sheets)
                self.assertEqual(len(complete_sheets['Personas']), 3)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
