"""
Entorno de pruebas local completo para SeñasConecta:
- Base de datos SQLite real con migraciones de worker/migrations/
- Puente RPC D1 para ejecutar worker/src/index.js en GJS
- Simulador local de GitHub OAuth (administrador autorizado y cuentas no autorizadas)
- Servidor estático de frontend/ (soporta pruebas mismo-origen y origen-cruzado)
"""

import html
import http.server
import json
import os
import pathlib
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse

ROOT_DIR = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = ROOT_DIR / 'worker' / 'migrations'
FRONTEND_DIR = ROOT_DIR / 'frontend'
WORKER_SCRIPT = ROOT_DIR / 'tests' / 'harness' / 'worker_server.mjs'


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class D1SqliteDatabase:
    def __init__(self, db_path=':memory:', run_seed=True):
        self.lock = threading.Lock()
        if db_path != ':memory:':
            pathlib.Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        with self.lock:
            self.conn.execute('PRAGMA foreign_keys = ON;')
            for sql_file in sorted(MIGRATIONS_DIR.glob('*.sql')):
                if not run_seed and sql_file.name == '0002_seed_defaults.sql':
                    continue
                sql = sql_file.read_text(encoding='utf-8')
                self.conn.executescript(sql)
            self.conn.commit()

    def execute_rpc(self, sql, params, mode):
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(sql, params)
            if mode == 'all':
                rows = [dict(r) for r in cur.fetchall()]
                return {'success': True, 'results': rows, 'meta': {'changes': 0, 'last_row_id': None}}
            if mode == 'first':
                row = cur.fetchone()
                return {'success': True, 'result': dict(row) if row else None}
            self.conn.commit()
            return {
                'success': True,
                'meta': {
                    'changes': cur.rowcount,
                    'last_row_id': cur.lastrowid,
                },
            }

    def close(self):
        with self.lock:
            self.conn.close()


def make_d1_handler(db: D1SqliteDatabase):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_POST(self):
            length = int(self.headers.get('Content-Length', '0'))
            raw = self.rfile.read(length).decode('utf-8')
            try:
                payload = json.loads(raw)
                res = db.execute_rpc(
                    payload['sql'],
                    payload.get('params', []),
                    payload.get('mode', 'all'),
                )
                body = json.dumps(res).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:
                err = json.dumps({'error': str(exc)}).encode('utf-8')
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(err)))
                self.end_headers()
                self.wfile.write(err)

    return Handler


class MockGithubState:
    def __init__(self, admin_id='100001'):
        self.admin_id = str(admin_id)
        self.default_mode = 'interactive'  # 'interactive' | 'admin' | 'other' | 'cancel'
        self.codes = {}
        self.tokens = {}


def make_github_handler(gh_state: MockGithubState):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)

            if parsed.path == '/login/oauth/authorize':
                redirect_uri = qs.get('redirect_uri', [''])[0]
                state = qs.get('state', [''])[0]
                choice = qs.get('mock_choice', [gh_state.default_mode])[0]

                if choice in ('admin', 'other'):
                    code = f'code_{choice}_{len(gh_state.codes) + 1}'
                    gh_state.codes[code] = choice
                    target = f'{redirect_uri}?code={urllib.parse.quote(code)}&state={urllib.parse.quote(state)}'
                    self.send_response(302)
                    self.send_header('Location', target)
                    self.end_headers()
                    return

                if choice == 'cancel':
                    target = f'{redirect_uri}?error=access_denied&state={urllib.parse.quote(state)}'
                    self.send_response(302)
                    self.send_header('Location', target)
                    self.end_headers()
                    return

                # Modo interactivo para navegador real
                admin_code = f'code_admin_{len(gh_state.codes) + 1}'
                other_code = f'code_other_{len(gh_state.codes) + 2}'
                gh_state.codes[admin_code] = 'admin'
                gh_state.codes[other_code] = 'other'
                admin_url = f'{redirect_uri}?code={urllib.parse.quote(admin_code)}&state={urllib.parse.quote(state)}'
                other_url = f'{redirect_uri}?code={urllib.parse.quote(other_code)}&state={urllib.parse.quote(state)}'
                cancel_url = f'{redirect_uri}?error=access_denied&state={urllib.parse.quote(state)}'

                page = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Simulador GitHub OAuth</title>
<style>body{{font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:20px;background:#f6f8fa}}
.card{{background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:24px}}
a.btn{{display:block;padding:12px 16px;margin:10px 0;border-radius:8px;text-decoration:none;font-weight:600;text-align:center}}
.ok{{background:#1f6feb;color:#fff}}.bad{{background:#cf222e;color:#fff}}.cancel{{background:#eaeef2;color:#24292f}}
</style></head><body><div class="card">
<h2>Simulador local de GitHub OAuth</h2>
<p>Selecciona la cuenta con la que deseas autorizar a SeñasConecta (scope solicitado: <code>{html.escape(qs.get('scope', [''])[0])}</code>):</p>
<a id="btn-auth-admin" class="btn ok" href="{html.escape(admin_url)}">Autorizar como Administrador (ID {html.escape(gh_state.admin_id)})</a>
<a id="btn-auth-other" class="btn bad" href="{html.escape(other_url)}">Autorizar con Otra Cuenta (ID 999999)</a>
<a id="btn-auth-cancel" class="btn cancel" href="{html.escape(cancel_url)}">Cancelar autorización</a>
</div></body></html>""".encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(page)))
                self.end_headers()
                self.wfile.write(page)
                return

            if parsed.path == '/user':
                auth_header = self.headers.get('Authorization', '')
                token = auth_header.replace('Bearer ', '').strip()
                role = gh_state.tokens.get(token)
                if not role:
                    self.send_response(401)
                    self.end_headers()
                    return
                if role == 'admin':
                    user = {'id': int(gh_state.admin_id), 'login': 'admin-senas', 'name': 'Administrador Territorial', 'avatar_url': ''}
                else:
                    user = {'id': 999999, 'login': 'usuario-externo', 'name': 'Cuenta Externa', 'avatar_url': ''}
                body = json.dumps(user).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            self.send_response(404)
            self.end_headers()

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == '/login/oauth/access_token':
                length = int(self.headers.get('Content-Length', '0'))
                payload = json.loads(self.rfile.read(length).decode('utf-8'))
                code = payload.get('code', '')
                role = gh_state.codes.pop(code, None)
                if not role:
                    body = json.dumps({'error': 'bad_verification_code'}).encode('utf-8')
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                token = f'gho_mock_{role}_{len(gh_state.tokens) + 1}'
                gh_state.tokens[token] = role
                body = json.dumps({'access_token': token, 'token_type': 'bearer', 'scope': 'read:user'}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            self.send_response(404)
            self.end_headers()

    return Handler


def make_frontend_handler(api_base_url: str | None):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

        def log_message(self, format, *args):
            pass

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == '/js/config.js' and api_base_url is not None:
                content = f"""export const CONFIG = {{
  API_BASE_URL: {json.dumps(api_base_url)},
}};
export function getApiBaseUrl() {{
  return String(window.SENASCONECTA_API_URL || CONFIG.API_BASE_URL || '').trim().replace(/\\/+$/, '');
}}
export function isApiUrlConfigured() {{
  return true;
}}
""".encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return
            super().do_GET()

    return Handler


class LocalTestStack:
    def __init__(
        self,
        admin_github_id='100001',
        frontend_host='127.0.0.1',
        worker_host='127.0.0.1',
        frontend_port=0,
        worker_port=0,
        session_ttl_hours='12',
        disable_rate_limit='1',
        db_path=':memory:',
        run_seed=True,
        extra_allowed_origins=None,
        github_oauth_base=None,
        github_api_base=None,
        github_client_id='mock-client-id',
        github_client_secret='mock-client-secret',
        session_pepper='test-pepper',
        serve_static_config=False,
    ):
        self.db = D1SqliteDatabase(db_path, run_seed=run_seed)
        self.gh_state = MockGithubState(admin_github_id)
        self.db_port = find_free_port()
        self.gh_port = find_free_port()
        self.worker_port = worker_port or find_free_port()
        self.frontend_port = frontend_port or find_free_port()
        self.frontend_host = frontend_host
        self.worker_host = worker_host
        self.session_ttl_hours = str(session_ttl_hours)
        self.disable_rate_limit = str(disable_rate_limit)
        self.extra_allowed_origins = list(extra_allowed_origins or [])
        self.github_oauth_base = github_oauth_base
        self.github_api_base = github_api_base
        self.github_client_id = github_client_id
        self.github_client_secret = github_client_secret
        self.session_pepper = session_pepper
        self.serve_static_config = serve_static_config
        self.servers = []
        self.worker_proc = None

    @property
    def worker_url(self):
        return f'http://{self.worker_host}:{self.worker_port}'

    @property
    def frontend_url(self):
        return f'http://{self.frontend_host}:{self.frontend_port}'

    def start(self):
        frontend_api_override = None if self.serve_static_config else self.worker_url
        server_specs = [
            (self.db_port, make_d1_handler(self.db)),
            (self.frontend_port, make_frontend_handler(frontend_api_override)),
        ]
        if not (self.github_oauth_base and self.github_api_base):
            server_specs.append((self.gh_port, make_github_handler(self.gh_state)))

        for port, handler_cls in server_specs:
            srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler_cls)
            t = threading.Thread(target=srv.serve_forever, daemon=True)
            t.start()
            self.servers.append(srv)

        allowed_origins = [
            f'http://127.0.0.1:{self.frontend_port}',
            f'http://localhost:{self.frontend_port}',
            *self.extra_allowed_origins,
        ]
        dedup_origins = ','.join(dict.fromkeys(allowed_origins))

        env = os.environ.copy()
        env.update(
            {
                'WORKER_PORT': str(self.worker_port),
                'DB_RPC_URL': f'http://127.0.0.1:{self.db_port}/d1',
                'FRONTEND_URL': self.frontend_url,
                'ALLOWED_ORIGINS': dedup_origins,
                'GITHUB_CLIENT_ID': self.github_client_id,
                'GITHUB_CLIENT_SECRET': self.github_client_secret,
                'ADMIN_GITHUB_ID': self.gh_state.admin_id,
                'SESSION_TTL_HOURS': self.session_ttl_hours,
                'COOKIE_SAMESITE': 'auto',
                'SESSION_PEPPER': self.session_pepper,
                'GITHUB_OAUTH_BASE': self.github_oauth_base or f'http://127.0.0.1:{self.gh_port}',
                'GITHUB_API_BASE': self.github_api_base or f'http://127.0.0.1:{self.gh_port}',
                'DISABLE_RATE_LIMIT': self.disable_rate_limit,
            }
        )
        self.worker_proc = subprocess.Popen(
            ['gjs', '-m', str(WORKER_SCRIPT)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.time() + 8.0
        while time.time() < deadline:
            line = self.worker_proc.stdout.readline()
            if 'WORKER_READY' in line:
                return
            if self.worker_proc.poll() is not None:
                err = self.worker_proc.stderr.read()
                raise RuntimeError(f'Worker GJS failed to start: {err}')
        raise RuntimeError('Timeout waiting for GJS worker startup')

    def stop(self):
        if self.worker_proc:
            self.worker_proc.terminate()
            try:
                self.worker_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.worker_proc.kill()
            if self.worker_proc.stdout:
                self.worker_proc.stdout.close()
            if self.worker_proc.stderr:
                self.worker_proc.stderr.close()
        for srv in self.servers:
            srv.shutdown()
            srv.server_close()
        self.db.close()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--frontend-port', type=int, default=8080)
    parser.add_argument('--worker-port', type=int, default=8787)
    args = parser.parse_args()

    stack = LocalTestStack(frontend_port=args.frontend_port, worker_port=args.worker_port)
    stack.start()
    print(f'FRONTEND_URL={stack.frontend_url}', flush=True)
    print(f'WORKER_URL={stack.worker_url}', flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        stack.stop()
