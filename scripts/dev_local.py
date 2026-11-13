#!/usr/bin/env python3
"""Servidor de desarrollo local persistente para SeñasConecta.

Levanta sin depender de Node.js ni Wrangler:
- Base de datos SQLite persistente en .local/senasconecta.sqlite (migrada desde worker/migrations/)
- Worker local (worker/src/index.js) ejecutado con GJS en http://127.0.0.1:8787
- Simulador local interactivo de GitHub OAuth (o GitHub real con --real-oauth)
- Frontend estático en http://127.0.0.1:8080 (y CORS habilitado para Live Server :5500)
"""

import argparse
import pathlib
import signal
import sys
import time

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from tests.harness.local_stack import LocalTestStack  # noqa: E402

DEV_VARS_PATH = ROOT_DIR / 'worker' / '.dev.vars'
DEFAULT_DB_PATH = ROOT_DIR / '.local' / 'senasconecta.sqlite'
PLACEHOLDER_TOKENS = (
    'tu_',
    'reemplazar',
    'placeholder',
    'example',
    'changeme',
    'mock-',
    'xxx',
)
EXTRA_DEV_ORIGINS = [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://127.0.0.1:5501',
    'http://localhost:5501',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
    'http://localhost:8000',
]


def load_dev_vars(path: pathlib.Path) -> dict[str, str]:
    """Lee variables KEY=VALUE desde worker/.dev.vars si existe."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values

    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, val = line.split('=', 1)
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        if key:
            values[key] = val
    return values


def is_placeholder(value: str | None) -> bool:
    """Detecta valores vacíos o de ejemplo que no corresponden a credenciales reales."""
    if not value:
        return True
    lower = value.strip().lower()
    if lower in ('0', '000000', '123456'):
        return True
    return any(token in lower for token in PLACEHOLDER_TOKENS)


def main() -> int:
    parser = argparse.ArgumentParser(description='Inicia SeñasConecta en modo local persistente.')
    parser.add_argument('--frontend-port', type=int, default=8080, help='Puerto HTTP del frontend (default: 8080)')
    parser.add_argument('--worker-port', type=int, default=8787, help='Puerto HTTP del Worker local (default: 8787)')
    parser.add_argument('--db', type=pathlib.Path, default=DEFAULT_DB_PATH, help='Ruta de la base SQLite local')
    parser.add_argument(
        '--real-oauth',
        action='store_true',
        help='Usa GitHub OAuth real leyendo worker/.dev.vars (requiere callback configurado hacia el Worker local)',
    )
    args = parser.parse_args()

    dev_vars = load_dev_vars(DEV_VARS_PATH)
    raw_admin_id = dev_vars.get('ADMIN_GITHUB_ID', '')
    admin_id = raw_admin_id if raw_admin_id.isdigit() and not is_placeholder(raw_admin_id) else '100001'
    session_pepper = dev_vars.get('SESSION_PEPPER') or 'dev-local-pepper-senasconecta'

    github_oauth_base = None
    github_api_base = None
    client_id = 'mock-client-id'
    client_secret = 'mock-client-secret'
    oauth_mode_label = f'Simulador local GitHub OAuth (admin ID: {admin_id})'

    if args.real_oauth:
        cid = dev_vars.get('GITHUB_CLIENT_ID', '')
        csec = dev_vars.get('GITHUB_CLIENT_SECRET', '')
        if is_placeholder(cid) or is_placeholder(csec) or not admin_id.isdigit():
            print(
                'Error: --real-oauth requiere GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET y ADMIN_GITHUB_ID '
                f'válidos en {DEV_VARS_PATH}.',
                file=sys.stderr,
            )
            return 1
        client_id = cid
        client_secret = csec
        github_oauth_base = 'https://github.com'
        github_api_base = 'https://api.github.com'
        oauth_mode_label = f'GitHub OAuth real desde worker/.dev.vars (admin ID: {admin_id})'

    db_path = args.db.resolve()
    run_seed = not db_path.exists()

    stack = LocalTestStack(
        admin_github_id=admin_id,
        frontend_port=args.frontend_port,
        worker_port=args.worker_port,
        db_path=str(db_path),
        run_seed=run_seed,
        extra_allowed_origins=EXTRA_DEV_ORIGINS,
        github_oauth_base=github_oauth_base,
        github_api_base=github_api_base,
        github_client_id=client_id,
        github_client_secret=client_secret,
        session_pepper=session_pepper,
        serve_static_config=(args.worker_port == 8787),
    )

    stopping = False

    def handle_signal(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        stack.start()
    except OSError as exc:
        print(f'No se pudieron abrir los puertos locales ({exc}).', file=sys.stderr)
        print('Verifica si ya hay otra instancia en :8080 o :8787, o usa --frontend-port / --worker-port.', file=sys.stderr)
        return 1

    print('==============================================================', flush=True)
    print('  SeñasConecta — Entorno local listo (Grupo Señas Osorno)', flush=True)
    print('==============================================================', flush=True)
    print(f'  Frontend principal : {stack.frontend_url}/', flush=True)
    print(f'  Worker API local   : {stack.worker_url}', flush=True)
    print(f'  Base SQLite local  : {db_path}', flush=True)
    print(f'  Autenticación      : {oauth_mode_label}', flush=True)
    print('  Live Server CORS   : habilitado para :5500, :5501, :5173 y :3000', flush=True)
    print('  Presiona Ctrl+C para detener el servidor.', flush=True)
    print('==============================================================', flush=True)

    try:
        while not stopping:
            if stack.worker_proc and stack.worker_proc.poll() is not None:
                err = stack.worker_proc.stderr.read() if stack.worker_proc.stderr else ''
                print(f'El Worker local terminó inesperadamente: {err}', file=sys.stderr)
                return 1
            time.sleep(0.5)
    finally:
        print('\nDeteniendo servidores locales de SeñasConecta...', flush=True)
        stack.stop()

    return 0


if __name__ == '__main__':
    raise SystemExit(main())

