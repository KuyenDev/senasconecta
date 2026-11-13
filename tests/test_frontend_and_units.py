"""
Pruebas estáticas, de seguridad y de análisis ES Module para frontend y políticas del Worker.
"""

import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / 'frontend'
WORKER_DIR = ROOT_DIR / 'worker'


class FrontendAndUnitTests(unittest.TestCase):
    def test_cookie_policy_unit_tests(self):
        proc = subprocess.run(
            ['gjs', '-m', str(ROOT_DIR / 'tests' / 'test_cookie_policy.mjs')],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, f'stderr: {proc.stderr}\nstdout: {proc.stdout}')
        self.assertIn('COOKIE_POLICY_TESTS_OK', proc.stdout)

    def test_all_frontend_modules_parse_cleanly(self):
        js_files = sorted((FRONTEND_DIR / 'js').rglob('*.js'))
        self.assertGreaterEqual(len(js_files), 14)

        # Importar todas las vistas y módulos excepto app.js (que ejecuta bootstrap sobre DOM completo)
        # y verificar sintaxis de app.js también mediante compilación de módulo con stubs DOM.
        imports_lines = []
        for idx, path in enumerate(js_files):
            if path.name == 'app.js':
                continue
            uri = path.resolve().as_uri()
            imports_lines.append(f"await import('{uri}');")

        app_uri = (FRONTEND_DIR / 'js' / 'app.js').resolve().as_uri()

        shim_uri = (ROOT_DIR / 'tests' / 'harness' / 'install_globals.mjs').resolve().as_uri()
        stub_script = f"""
await import('{shim_uri}');
const noop = () => {{}};
const makeEl = () => ({{
  classList: {{ add: noop, remove: noop, toggle: noop }},
  setAttribute: noop,
  removeAttribute: noop,
  addEventListener: noop,
  appendChild: noop,
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  style: {{}},
  dataset: {{}},
  firstChild: null,
}});
globalThis.location = {{ href: 'http://127.0.0.1:8080/', hostname: '127.0.0.1', hash: '', assign: noop }};
globalThis.history = {{ replaceState: noop }};
globalThis.addEventListener = noop;
globalThis.document = {{
  title: 'SeñasConecta',
  getElementById: () => makeEl(),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  createTextNode: (t) => ({{ text: t }}),
  addEventListener: noop,
  head: makeEl(),
  body: makeEl(),
  activeElement: null,
}};
globalThis.fetch = async () => ({{
  ok: true,
  status: 200,
  headers: {{ get: () => 'application/json' }},
  json: async () => ({{ authenticated: false, oauth_configured: true }}),
}});
{chr(10).join(imports_lines)}
await import('{app_uri}');
print('FRONTEND_MODULES_OK');
"""
        with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as f:
            f.write(stub_script)
            tmp_path = f.name

        try:
            proc = subprocess.run(['gjs', '-m', tmp_path], capture_output=True, text=True, check=False)
            self.assertEqual(proc.returncode, 0, f'stderr: {proc.stderr}\nstdout: {proc.stdout}')
            self.assertIn('FRONTEND_MODULES_OK', proc.stdout)
        finally:
            pathlib.Path(tmp_path).unlink(missing_ok=True)

    def test_security_hygiene_invariants(self):
        frontend_js = list((FRONTEND_DIR / 'js').rglob('*.js'))
        for path in frontend_js:
            raw = path.read_text(encoding='utf-8')
            code_only = re.sub(r'/\*[\s\S]*?\*/|//.*', '', raw)
            self.assertNotIn('localStorage', code_only, f'Prohibido localStorage en {path}')
            self.assertNotIn('sessionStorage', code_only, f'Prohibido sessionStorage en {path}')
            self.assertNotIn('innerHTML', code_only, f'Prohibido innerHTML en {path}')
            self.assertNotIn('outerHTML', code_only, f'Prohibido outerHTML en {path}')
            self.assertNotIn('document.write', code_only, f'Prohibido document.write en {path}')
            self.assertNotIn('GITHUB_CLIENT_SECRET', code_only, f'Secreto en frontend {path}')

        index_html = (FRONTEND_DIR / 'index.html').read_text(encoding='utf-8')
        self.assertNotIn('jw.org', index_html.lower())
        self.assertNotRegex(index_html, r'\bonclick\s*=')

        wrangler = (WORKER_DIR / 'wrangler.toml').read_text(encoding='utf-8')
        self.assertIsNone(re.search(r'GITHUB_CLIENT_SECRET\s*=', wrangler))

    def test_config_github_pages_and_local_priority(self):
        cfg_src = (FRONTEND_DIR / 'js' / 'config.js').read_text(encoding='utf-8')
        patched_src = cfg_src.replace(
            "API_BASE_URL: ''",
            "API_BASE_URL: 'https://senasconecta-api.ejemplo.workers.dev'",
            1,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_cfg = pathlib.Path(tmpdir) / 'config.prod.js'
            tmp_cfg.write_text(patched_src, encoding='utf-8')
            raw_uri = (FRONTEND_DIR / 'js' / 'config.js').resolve().as_uri()
            prod_uri = tmp_cfg.as_uri()
            test_script = f"""
function assert(cond, msg) {{
  if (!cond) throw new Error('Assertion failed: ' + msg);
}}

globalThis.location = {{ hostname: 'usuario.github.io', port: '' }};
globalThis.SENASCONECTA_API_URL = '';
const rawCfg = await import('{raw_uri}');
assert(rawCfg.getApiBaseUrl() === '', 'Empty API_BASE_URL on github.io returns empty');
assert(rawCfg.isApiUrlConfigured() === false, 'Unconfigured on github.io returns false');

const prodCfg = await import('{prod_uri}');
assert(
  prodCfg.getApiBaseUrl() === 'https://senasconecta-api.ejemplo.workers.dev',
  'GitHub Pages uses configured Worker API_BASE_URL'
);
assert(prodCfg.isApiUrlConfigured() === true, 'Configured on github.io returns true');

globalThis.location = {{ hostname: '127.0.0.1', port: '5500' }};
assert(
  prodCfg.getApiBaseUrl() === 'http://127.0.0.1:8787',
  'Local Live Server :5500 still targets :8787 even when GitHub Pages API_BASE_URL is configured'
);

globalThis.SENASCONECTA_API_URL = 'https://override.example';
assert(
  prodCfg.getApiBaseUrl() === 'https://override.example',
  'Explicit runtime override still wins'
);
print('CONFIG_PRIORITY_TESTS_OK');
"""
            runner = pathlib.Path(tmpdir) / 'run_cfg_test.mjs'
            runner.write_text(test_script, encoding='utf-8')
            proc = subprocess.run(['gjs', '-m', str(runner)], capture_output=True, text=True, check=False)
            self.assertEqual(proc.returncode, 0, f'stderr: {proc.stderr}\nstdout: {proc.stdout}')
            self.assertIn('CONFIG_PRIORITY_TESTS_OK', proc.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
