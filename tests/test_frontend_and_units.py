"""Pruebas unitarias estáticas, integridad de JSON publicados e higiene de seguridad."""

import json
import pathlib
import re
import subprocess
import unittest

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / 'frontend'
DATA_DIR = FRONTEND_DIR / 'data'


class FrontendUnitsAndSecurityTests(unittest.TestCase):
    def test_all_frontend_modules_parse_cleanly(self):
        import tempfile

        js_files = sorted(FRONTEND_DIR.rglob('*.js')) + sorted(FRONTEND_DIR.rglob('*.mjs'))
        self.assertGreaterEqual(len(js_files), 10)
        with tempfile.TemporaryDirectory() as tmp:
            for idx, js_file in enumerate(js_files):
                with self.subTest(file=js_file.name):
                    probe = pathlib.Path(tmp) / f'check_{idx}.mjs'
                    probe.write_text(
                        f"import {json.dumps(js_file.as_uri())};\n",
                        encoding='utf-8',
                    )
                    proc = subprocess.run(['gjs', '-m', str(probe)], capture_output=True, text=True, check=False)
                    self.assertNotIn('SyntaxError', proc.stderr, proc.stderr)
                    self.assertNotIn('Unable to load file', proc.stderr, proc.stderr)
                    self.assertNotIn('ImportError', proc.stderr, proc.stderr)

    def test_published_json_database_files_valid(self):
        required = ['categorias.json', 'localidades.json', 'personas.json', 'seguimientos.json', 'meta.json']
        for name in required:
            path = DATA_DIR / name
            self.assertTrue(path.exists(), f'Falta archivo de datos publicado: {path}')

        categorias = json.loads((DATA_DIR / 'categorias.json').read_text(encoding='utf-8'))
        localidades = json.loads((DATA_DIR / 'localidades.json').read_text(encoding='utf-8'))
        personas = json.loads((DATA_DIR / 'personas.json').read_text(encoding='utf-8'))
        seguimientos = json.loads((DATA_DIR / 'seguimientos.json').read_text(encoding='utf-8'))
        meta = json.loads((DATA_DIR / 'meta.json').read_text(encoding='utf-8'))

        for group in ('estado_registro', 'medio_comunicacion', 'nivel_lsch', 'tipo_seguimiento', 'estado_seguimiento'):
            self.assertIn(group, categorias)
            self.assertGreater(len(categorias[group]), 0)

        loc_names = {l['nombre'] for l in localidades}
        for base_loc in ('Osorno', 'Río Negro', 'San Pablo'):
            self.assertIn(base_loc, loc_names)
        self.assertIsInstance(personas, list)
        self.assertIsInstance(seguimientos, list)
        self.assertEqual(meta['app'], 'senasconecta')
        self.assertEqual(meta['grupo'], 'Grupo Señas Osorno')

    def test_security_and_static_hygiene_invariants(self):
        forbidden_tokens = [
            'localStorage',
            'sessionStorage',
            'innerHTML',
            'outerHTML',
            'insertAdjacentHTML',
            'document.write',
            'eval(',
            'jw.org',
            'workers.dev',
            '/auth/login',
            'config.js',
            'auth.js',
        ]
        files_to_scan = (
            list(FRONTEND_DIR.glob('*.html'))
            + list((FRONTEND_DIR / 'js').rglob('*.js'))
            + list((FRONTEND_DIR / 'css').rglob('*.css'))
        )
        for path in files_to_scan:
            text = path.read_text(encoding='utf-8')
            for token in forbidden_tokens:
                self.assertNotIn(token, text, f'Prohibited token "{token}" found in {path}')

        html_text = (FRONTEND_DIR / 'index.html').read_text(encoding='utf-8')
        self.assertIsNone(re.search(r'\son[a-z]+\s*=', html_text, re.IGNORECASE), 'Inline HTML event handlers forbidden')
        self.assertIn('href="./assets/favicon.svg"', html_text)
        self.assertIn('href="./css/styles.css"', html_text)
        self.assertIn('src="./js/app.js"', html_text)
        self.assertNotIn('href="/', html_text)
        self.assertNotIn('src="/', html_text)

        self.assertTrue((FRONTEND_DIR / '.nojekyll').exists())
        wf_text = (ROOT_DIR / '.github' / 'workflows' / 'deploy-pages.yml').read_text(encoding='utf-8')
        self.assertIn('path: "frontend"', wf_text)
        self.assertNotIn('SENASCONECTA_API_URL', wf_text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
