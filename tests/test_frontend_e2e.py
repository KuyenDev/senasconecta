"""Pruebas End-to-End del frontend estático de SeñasConecta sobre HTTP real."""

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
        server, port = serve_directory(FRONTEND_DIR)
        try:
            url = f'http://127.0.0.1:{port}'
            out = self._run_e2e('empty_published', url, f'{url}/index.html#dashboard')
            self.assertIn('E2E_EMPTY_PUBLISHED_OK', out)
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
                    (
                        'Seguimientos',
                        [
                            importar_excel.SEGUIMIENTO_TEMPLATE_HEADERS,
                            [
                                '',
                                'Sofía Cárdenas',
                                'Osorno',
                                '2026-03-01',
                                'Necesidad de interpretación',
                                'Pendiente',
                                'Coordinar intérprete LSCh',
                            ],
                        ],
                    ),
                ],
            )
            importar_excel.sync_excel_to_json(excel_dir, subpath_site / 'data')

            server, port = serve_directory(web_root)
            try:
                base_url = f'http://127.0.0.1:{port}/senasconecta'
                out = self._run_e2e('excel_populated', base_url, f'{base_url}/#dashboard')
                self.assertIn('E2E_EXCEL_POPULATED_OK', out)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
