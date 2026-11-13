"""
Pruebas End-to-End ejecutando frontend/js/app.js y todas las vistas reales
sobre HTTP contra worker/src/index.js y SQLite real.
"""

import os
import pathlib
import subprocess
import sys
import unittest

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness.local_stack import LocalTestStack

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
RUNNER = ROOT_DIR / 'tests' / 'harness' / 'frontend_e2e_runner.mjs'


class FrontendE2ETests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stack = LocalTestStack(admin_github_id='100001')
        cls.stack.start()

    @classmethod
    def tearDownClass(cls):
        cls.stack.stop()

    def _run_scenario(self, scenario, initial_href=None, cookie=''):
        env = os.environ.copy()
        env.update(
            {
                'WORKER_URL': self.stack.worker_url,
                'FRONTEND_URL': self.stack.frontend_url,
                'TEST_SCENARIO': scenario,
                'INITIAL_HREF': initial_href or f'{self.stack.frontend_url}/',
                'AUTH_COOKIE': cookie,
            }
        )
        proc = subprocess.run(['gjs', '-m', str(RUNNER)], env=env, capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, f'Scenario {scenario} failed:\nSTDOUT:{proc.stdout}\nSTDERR:{proc.stderr}')
        return proc.stdout

    def test_01_public_readonly_and_auth_error_states(self):
        out_unauth = self._run_scenario('unauth')
        self.assertIn('E2E_UNAUTH_OK', out_unauth)

        out_denied = self._run_scenario(
            'unauthorized_feedback',
            initial_href=f'{self.stack.frontend_url}/?auth_error=unauthorized',
        )
        self.assertIn('E2E_UNAUTHORIZED_FEEDBACK_OK', out_denied)

        out_cookie = self._run_scenario(
            'cookie_blocked',
            initial_href=f'{self.stack.frontend_url}/?auth=ok',
        )
        self.assertIn('E2E_COOKIE_BLOCKED_OK', out_cookie)

        out_offline = self._run_scenario(
            'backend_unreachable',
            initial_href='http://127.0.0.1:5500/frontend/index.html#dashboard',
        )
        self.assertIn('E2E_BACKEND_UNREACHABLE_OK', out_offline)

    def test_02_authenticated_admin_crud_and_public_readonly_verification(self):
        # Obtener cookie real mediante flujo completo OAuth contra el Worker
        self.stack.gh_state.default_mode = 'admin'
        client = httpx.Client(follow_redirects=False, timeout=10.0)
        r1 = client.get(f'{self.stack.worker_url}/auth/login')
        r2 = client.get(r1.headers['Location'])
        r3 = client.get(r2.headers['Location'])
        self.assertIn('auth=ok', r3.headers['Location'])
        cookie_val = client.cookies.get('sc_session') or client.cookies.get('__Host-sc_session')
        cookie_name = 'sc_session' if client.cookies.get('sc_session') else '__Host-sc_session'
        client.close()

        out_full = self._run_scenario(
            'full',
            initial_href=f'{self.stack.frontend_url}/?auth=ok',
            cookie=f'{cookie_name}={cookie_val}',
        )
        self.assertIn('E2E_FULL_APP_OK', out_full)

        # Verificar persistencia en SQLite y eliminación de sesión tras cerrar sesión desde el frontend
        with self.stack.db.lock:
            p_row = self.stack.db.conn.execute(
                "SELECT nombre, apellido, sector FROM personas WHERE nombre = 'Sofía'"
            ).fetchone()
            self.assertIsNotNone(p_row)
            self.assertEqual(p_row['apellido'], 'Cárdenas')
            self.assertEqual(p_row['sector'], 'Rahue Bajo')

            sess_count = self.stack.db.conn.execute('SELECT COUNT(*) FROM sesiones').fetchone()[0]
            self.assertEqual(sess_count, 0)

        # Confirmar que cualquier visitante sin sesión puede consultar los datos creados en modo solo lectura
        out_readonly = self._run_scenario('readonly_browse')
        self.assertIn('E2E_READONLY_BROWSE_OK', out_readonly)


if __name__ == '__main__':
    unittest.main(verbosity=2)

