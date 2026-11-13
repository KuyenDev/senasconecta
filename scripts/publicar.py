#!/usr/bin/env python3
"""Automatiza la integración Excel -> pruebas -> Git -> GitHub -> GitHub Pages.

Uso rápido:
    python3 scripts/publicar.py
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW_FILE = 'deploy-pages.yml'
DEFAULT_REPO = 'senasconecta'


def run_cmd(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT_DIR, text=True, check=check)


def get_github_credentials() -> tuple[str | None, str]:
    env = os.environ.copy()
    env['GIT_TERMINAL_PROMPT'] = '0'
    proc = subprocess.run(
        ['git', 'credential', 'fill'],
        cwd=ROOT_DIR,
        input='protocol=https\nhost=github.com\n\n',
        text=True,
        capture_output=True,
        env=env,
        timeout=10,
        check=False,
    )
    info: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            info[k.strip()] = v.strip()
    token = info.get('password', '').strip()
    if not token:
        raise RuntimeError(
            'No hay credenciales GitHub guardadas en git credential helper. '
            'Configura tu cuenta con "git credential-store" o "gh auth login".'
        )
    return info.get('username'), token


def github_api(
    token: str,
    method: str,
    path: str,
    payload: dict | None = None,
) -> tuple[int, dict | list | None]:
    url = path if path.startswith('https://') else f'https://api.github.com{path}'
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SenasConecta-Publisher',
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode('utf-8').strip()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        raw = err.read().decode('utf-8', errors='replace').strip()
        parsed = None
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {'message': raw}
        return err.code, parsed


def ensure_github_repo(token: str, login: str, repo_name: str, private: bool) -> dict:
    for candidate in (repo_name, 'senasConecta') if repo_name == DEFAULT_REPO else (repo_name,):
        code, info = github_api(token, 'GET', f'/repos/{login}/{candidate}')
        if code == 200 and isinstance(info, dict):
            return info

    print(f'Creando repositorio GitHub {login}/{repo_name} (private={private})...')
    code, created = github_api(
        token,
        'POST',
        '/user/repos',
        {
            'name': repo_name,
            'description': 'SeñasConecta · Organización territorial del Grupo Señas Osorno',
            'private': private,
            'auto_init': False,
        },
    )
    if code not in (200, 201) or not isinstance(created, dict):
        msg = created.get('message') if isinstance(created, dict) else str(created)
        raise RuntimeError(f'No se pudo crear el repositorio en GitHub ({code}): {msg}')
    return created


def ensure_origin_remote(clone_url: str) -> None:
    proc = subprocess.run(
        ['git', 'remote', 'get-url', 'origin'],
        cwd=ROOT_DIR,
        text=True,
        capture_output=True,
        check=False,
    )
    current = proc.stdout.strip() if proc.returncode == 0 else ''
    if not current:
        run_cmd(['git', 'remote', 'add', 'origin', clone_url])
        return
    if 'TU_USUARIO' in current or 'TU_REPOSITORIO' in current or current != clone_url:
        run_cmd(['git', 'remote', 'set-url', 'origin', clone_url])


def run_test_suite() -> None:
    for test_rel in (
        'tests/test_excel_importer.py',
        'tests/test_frontend_and_units.py',
        'tests/test_frontend_e2e.py',
    ):
        print(f'Ejecutando {test_rel}...')
        run_cmd([sys.executable, test_rel])


def commit_and_push_main(message: str) -> str:
    run_cmd(['git', 'branch', '-M', 'main'])
    status = subprocess.run(
        ['git', 'status', '--porcelain'],
        cwd=ROOT_DIR,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    if status:
        run_cmd(['git', 'add', '-A'])
        run_cmd(['git', 'commit', '-m', message])

    sha = subprocess.run(
        ['git', 'rev-parse', 'HEAD'],
        cwd=ROOT_DIR,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()

    env = os.environ.copy()
    env['GIT_TERMINAL_PROMPT'] = '0'
    subprocess.run(['git', 'push', '-u', 'origin', 'main'], cwd=ROOT_DIR, env=env, check=True)
    return sha


def ensure_github_pages_enabled(token: str, full_name: str, is_private: bool, plan_name: str) -> str:
    if is_private and plan_name == 'free':
        raise RuntimeError(
            f'El repositorio {full_name} es privado y el plan GitHub "free" no permite GitHub Pages en repositorios privados.'
        )

    code, info = github_api(token, 'GET', f'/repos/{full_name}/pages')
    pages_payload = {
        'build_type': 'workflow',
        'source': {'branch': 'main', 'path': '/'},
    }
    if code == 404:
        print(f'Activando GitHub Pages (GitHub Actions) en {full_name}...')
        c2, created = github_api(token, 'POST', f'/repos/{full_name}/pages', pages_payload)
        if c2 not in (200, 201, 409) or not isinstance(created, dict):
            msg = created.get('message') if isinstance(created, dict) else str(created)
            raise RuntimeError(f'Error activando GitHub Pages ({c2}): {msg}')
        info = created
    elif code == 200 and isinstance(info, dict):
        if info.get('build_type') != 'workflow':
            c2, updated = github_api(token, 'PUT', f'/repos/{full_name}/pages', pages_payload)
            if c2 not in (200, 204):
                raise RuntimeError(f'No se pudo cambiar build_type de Pages a workflow ({c2}): {updated}')
            if isinstance(updated, dict):
                info = updated
    else:
        raise RuntimeError(f'No se pudo consultar GitHub Pages ({code}): {info}')

    html_url = (info or {}).get('html_url')
    if not html_url:
        owner, repo = full_name.split('/', 1)
        html_url = f'https://{owner.lower()}.github.io/{repo}/'
    return html_url.rstrip('/') + '/'


def trigger_and_wait_pages_workflow(token: str, full_name: str, head_sha: str, wait_deploy: bool) -> str:
    time.sleep(2)
    code, runs_resp = github_api(token, 'GET', f'/repos/{full_name}/actions/workflows/{WORKFLOW_FILE}/runs?per_page=10')
    runs = runs_resp.get('workflow_runs', []) if code == 200 and isinstance(runs_resp, dict) else []

    matching = [r for r in runs if r.get('head_sha') == head_sha]
    should_dispatch = not matching or all(r.get('conclusion') not in (None, 'success') for r in matching)

    if should_dispatch:
        print('Lanzando workflow deploy-pages.yml manualmente en GitHub Actions...')
        d_code, d_resp = github_api(
            token,
            'POST',
            f'/repos/{full_name}/actions/workflows/{WORKFLOW_FILE}/dispatches',
            {'ref': 'main'},
        )
        if d_code not in (201, 204):
            raise RuntimeError(f'No se pudo iniciar el workflow en GitHub Actions ({d_code}): {d_resp}')
        time.sleep(3)

    if not wait_deploy:
        return 'dispatched'

    print('Esperando que GitHub Actions publique en GitHub Pages...')
    deadline = time.time() + 180
    last_status = ''
    while time.time() < deadline:
        code, runs_resp = github_api(token, 'GET', f'/repos/{full_name}/actions/workflows/{WORKFLOW_FILE}/runs?per_page=10')
        runs = runs_resp.get('workflow_runs', []) if code == 200 and isinstance(runs_resp, dict) else []
        target = next((r for r in runs if r.get('head_sha') == head_sha), runs[0] if runs else None)
        if target:
            st = target.get('status') or ''
            concl = target.get('conclusion')
            state_str = f'{st}/{concl}'
            if state_str != last_status:
                print(f'  Estado workflow (#{target.get("run_number")}): status={st}, conclusion={concl}')
                last_status = state_str
            if st == 'completed':
                if concl == 'success':
                    return 'success'
                raise RuntimeError(f'El despliegue en GitHub Actions falló con conclusión={concl} ({target.get("html_url")})')
        time.sleep(5)

    raise TimeoutError('Tiempo de espera agotado esperando la publicación en GitHub Actions.')


def verify_live_site(pages_url: str) -> None:
    for suffix in ('', 'data/localidades.json', 'data/meta.json'):
        url = f'{pages_url}{suffix}'
        last_err = None
        for _ in range(6):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'SenasConecta-Verifier'})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    if resp.status == 200:
                        break
            except Exception as err:
                last_err = err
                time.sleep(3)
        else:
            raise RuntimeError(f'El sitio publicado no respondió 200 OK en {url}: {last_err}')


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Integra datos Excel a JSON, valida pruebas y publica automáticamente en GitHub Pages.'
    )
    parser.add_argument('--repo', default=DEFAULT_REPO, help='Nombre del repositorio en GitHub (por defecto: senasconecta)')
    parser.add_argument('--mensaje', default='Actualizar datos y publicar en GitHub Pages', help='Mensaje de commit')
    parser.add_argument('--replace', action='store_true', help='Reemplaza registros previos desde los archivos en datos_excel/')
    parser.add_argument('--privado', action='store_true', help='Crea el repositorio como privado (requiere GitHub Pro/Team para Pages)')
    parser.add_argument('--skip-tests', action='store_true', help='Omite la ejecución de pruebas antes de subir')
    parser.add_argument('--no-wait', action='store_true', help='No espera a que GitHub Actions finalice el despliegue')
    args = parser.parse_args()

    sys.path.insert(0, str(ROOT_DIR / 'scripts'))
    import importar_excel  # noqa: E402

    print('1) Integrando planillas de datos_excel/ a frontend/data/*.json...')
    sync_stats = importar_excel.sync_excel_to_json(replace=args.replace)
    print(json.dumps(sync_stats, ensure_ascii=False, indent=2))

    if not args.skip_tests:
        print('2) Ejecutando pruebas automatizadas...')
        run_test_suite()

    print('3) Verificando cuenta y repositorio en GitHub...')
    _, token = get_github_credentials()
    u_code, user_data = github_api(token, 'GET', '/user')
    if u_code != 200 or not isinstance(user_data, dict):
        raise RuntimeError(f'No se pudo autenticar con la API de GitHub ({u_code}).')

    login = user_data['login']
    plan_name = (user_data.get('plan') or {}).get('name', 'free')
    repo_info = ensure_github_repo(token, login, args.repo, args.privado)
    full_name = repo_info['full_name']
    clone_url = repo_info['clone_url']
    is_private = bool(repo_info.get('private'))

    print(f'4) Enlazando remoto origin -> {clone_url} y subiendo rama main...')
    ensure_origin_remote(clone_url)
    head_sha = commit_and_push_main(args.mensaje)

    print('5) Configurando GitHub Pages...')
    pages_url = ensure_github_pages_enabled(token, full_name, is_private, plan_name)

    print('6) Ejecutando y verificando publicación en GitHub Actions...')
    deploy_state = trigger_and_wait_pages_workflow(token, full_name, head_sha, wait_deploy=not args.no_wait)
    if deploy_state == 'success':
        verify_live_site(pages_url)

    print(
        json.dumps(
            {
                'repositorio': repo_info.get('html_url'),
                'commit': head_sha,
                'pages_url': pages_url,
                'estado_despliegue': deploy_state,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
