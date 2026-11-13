"""
Suite completa de pruebas de integración contra el Cloudflare Worker real (worker/src/index.js)
ejecutado en GJS SpiderMonkey sobre SQLite real y simulador GitHub OAuth.
"""

import json
import pathlib
import sys
import unittest
import urllib.parse

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from harness.local_stack import LocalTestStack


class WorkerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stack = LocalTestStack(admin_github_id='100001')
        cls.stack.start()
        cls.base = cls.stack.worker_url
        cls.origin = cls.stack.frontend_url

    @classmethod
    def tearDownClass(cls):
        cls.stack.stop()

    def setUp(self):
        # Limpiar datos dinámicos entre pruebas manteniendo categorías y localidades iniciales si se desea
        with self.stack.db.lock:
            self.stack.db.conn.executescript(
                """
                DELETE FROM seguimientos;
                DELETE FROM personas;
                DELETE FROM congregacion_localidades;
                DELETE FROM congregaciones;
                DELETE FROM sesiones;
                DELETE FROM oauth_states;
                DELETE FROM rate_limits;
                """
            )
            self.stack.db.conn.commit()
        self.stack.gh_state.default_mode = 'admin'

    def _login_as(self, mode='admin'):
        self.stack.gh_state.default_mode = mode
        client = httpx.Client(follow_redirects=False, timeout=10.0)
        r_login = client.get(f'{self.base}/auth/login')
        self.assertEqual(r_login.status_code, 302)
        auth_loc = r_login.headers['Location']
        self.assertIn('scope=read%3Auser', auth_loc)
        self.assertNotIn('repo', auth_loc)

        # Paso 2: Simulador GitHub autoriza y redirige al callback
        r_gh = client.get(auth_loc)
        self.assertEqual(r_gh.status_code, 302)
        cb_url = r_gh.headers['Location']

        # Paso 3: Worker callback valida state, intercambia código y crea sesión
        r_cb = client.get(cb_url)
        self.assertEqual(r_cb.status_code, 302)
        return client, r_cb, cb_url

    def _get_csrf(self, client):
        r = client.get(f'{self.base}/api/auth/session')
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data['authenticated'])
        return data['csrf_token'], data

    def _headers(self, csrf_token):
        return {
            'Origin': self.origin,
            'X-CSRF-Token': csrf_token,
            'Content-Type': 'application/json',
        }

    def test_01_public_read_and_admin_protected_endpoints(self):
        client = httpx.Client(timeout=10.0)
        r_sess = client.get(f'{self.base}/api/auth/session')
        self.assertEqual(r_sess.status_code, 200)
        self.assertEqual(r_sess.json()['authenticated'], False)

        # Endpoints de solo lectura disponibles para cualquier visitante
        public_reads = [
            '/api/dashboard',
            '/api/personas',
            '/api/localidades',
            '/api/congregaciones',
            '/api/seguimientos',
            '/api/estadisticas',
            '/api/configuracion',
        ]
        for path in public_reads:
            r = client.get(f'{self.base}{path}', headers={'Origin': self.origin})
            self.assertEqual(r.status_code, 200, f'Public GET {path} should succeed in read-only mode')
            if path == '/api/configuracion':
                self.assertNotIn('sistema', r.json())

        # Mutaciones y administración de respaldos siguen estrictamente protegidas (401)
        protected = [
            ('POST', '/api/personas'),
            ('PUT', '/api/personas/1'),
            ('DELETE', '/api/personas/1'),
            ('POST', '/api/localidades'),
            ('PUT', '/api/localidades/1'),
            ('PATCH', '/api/localidades/1/estado'),
            ('DELETE', '/api/localidades/1'),
            ('POST', '/api/congregaciones'),
            ('PUT', '/api/congregaciones/1'),
            ('PATCH', '/api/congregaciones/1/estado'),
            ('DELETE', '/api/congregaciones/1'),
            ('POST', '/api/seguimientos'),
            ('PUT', '/api/seguimientos/1'),
            ('DELETE', '/api/seguimientos/1'),
            ('POST', '/api/configuracion/categorias'),
            ('PUT', '/api/configuracion/categorias/1'),
            ('GET', '/api/respaldos/exportar?formato=json'),
            ('POST', '/api/respaldos/previsualizar'),
            ('POST', '/api/respaldos/importar'),
            ('POST', '/api/auth/logout'),
        ]
        for method, path in protected:
            r = client.request(method, f'{self.base}{path}', headers={'Origin': self.origin})
            self.assertEqual(r.status_code, 401, f'Endpoint {method} {path} should require admin auth')
        client.close()

    def test_02_oauth_admin_login_and_non_admin_rejection(self):
        # Cuenta no autorizada (ID 999999)
        bad_client, r_bad_cb, _ = self._login_as('other')
        self.assertIn('auth_error=unauthorized', r_bad_cb.headers['Location'])
        r_bad_sess = bad_client.get(f'{self.base}/api/auth/session')
        self.assertFalse(r_bad_sess.json()['authenticated'])
        r_bad_mutate = bad_client.post(
            f'{self.base}/api/localidades',
            headers={'Origin': self.origin, 'Content-Type': 'application/json'},
            json={'nombre': 'LocalidadNoAutorizada'},
        )
        self.assertEqual(r_bad_mutate.status_code, 401)
        bad_client.close()

        # Administrador autorizado (ID 100001)
        ok_client, r_ok_cb, cb_url = self._login_as('admin')
        self.assertIn('auth=ok', r_ok_cb.headers['Location'])
        csrf, sess_data = self._get_csrf(ok_client)
        self.assertEqual(sess_data['admin']['login'], 'admin-senas')

        # Verificar que en BD solo existe el hash del token y NO el token OAuth ni cookie en claro
        cookie_val = ok_client.cookies.get('sc_session') or ok_client.cookies.get('__Host-sc_session')
        self.assertTrue(cookie_val)
        with self.stack.db.lock:
            row = self.stack.db.conn.execute('SELECT * FROM sesiones').fetchone()
            self.assertIsNotNone(row)
            self.assertNotEqual(row['token_hash'], cookie_val)
            self.assertEqual(len(row['token_hash']), 64)

        # Estado de un solo uso: reintentar mismo callback debe fallar
        r_replay = ok_client.get(cb_url)
        self.assertEqual(r_replay.status_code, 302)
        self.assertIn('auth_error=invalid_state', r_replay.headers['Location'])
        ok_client.close()

    def test_03_oauth_state_and_login_csrf_protection(self):
        # Callback sin cookie sc_oauth_bind debe ser rechazado
        self.stack.gh_state.default_mode = 'admin'
        c1 = httpx.Client(follow_redirects=False, timeout=10.0)
        r1 = c1.get(f'{self.base}/auth/login')
        r_gh = c1.get(r1.headers['Location'])
        cb_url = r_gh.headers['Location']

        # Otro cliente sin cookie bind intenta usar el callback (Login CSRF)
        c_attacker = httpx.Client(follow_redirects=False, timeout=10.0)
        r_attack = c_attacker.get(cb_url)
        self.assertEqual(r_attack.status_code, 302)
        self.assertIn('auth_error=invalid_state', r_attack.headers['Location'])
        c1.close()
        c_attacker.close()

    def test_04_session_expiration_csrf_and_logout(self):
        client, _, _ = self._login_as('admin')
        csrf, _ = self._get_csrf(client)

        # Mutación sin CSRF falla con 403
        r_no_csrf = client.post(
            f'{self.base}/api/localidades',
            headers={'Origin': self.origin, 'Content-Type': 'application/json'},
            json={'nombre': 'PruebaSinCsrf'},
        )
        self.assertEqual(r_no_csrf.status_code, 403)

        # Mutación desde origen no autorizado falla con 403
        r_bad_origin = client.post(
            f'{self.base}/api/localidades',
            headers={'Origin': 'https://evil.example', 'X-CSRF-Token': csrf, 'Content-Type': 'application/json'},
            json={'nombre': 'PruebaOrigenMalo'},
        )
        self.assertEqual(r_bad_origin.status_code, 403)

        # Cierre de sesión invalida cookie en D1 y revoca permisos de escritura/respaldo
        r_out = client.post(f'{self.base}/api/auth/logout', headers=self._headers(csrf))
        self.assertEqual(r_out.status_code, 200)
        self.assertEqual(client.get(f'{self.base}/api/personas').status_code, 200)
        self.assertEqual(client.get(f'{self.base}/api/respaldos/exportar?formato=json').status_code, 401)
        self.assertEqual(
            client.post(f'{self.base}/api/localidades', headers=self._headers(csrf), json={'nombre': 'TrasLogout'}).status_code,
            401,
        )
        client.close()

        # Expiración de sesión
        client2, _, _ = self._login_as('admin')
        csrf2, _ = self._get_csrf(client2)
        self.assertEqual(client2.get(f'{self.base}/api/respaldos/exportar?formato=json').status_code, 200)
        with self.stack.db.lock:
            self.stack.db.conn.execute("UPDATE sesiones SET expiracion = '2020-01-01T00:00:00.000Z'")
            self.stack.db.conn.commit()
        r_exp = client2.post(
            f'{self.base}/api/localidades',
            headers=self._headers(csrf2),
            json={'nombre': 'Expirada'},
        )
        self.assertEqual(r_exp.status_code, 401)
        self.assertEqual(r_exp.json()['code'], 'SESSION_EXPIRED')
        client2.close()

    def test_05_full_crud_territory_personas_followups_stats_backups(self):
        client, _, _ = self._login_as('admin')
        csrf, _ = self._get_csrf(client)
        hdrs = self._headers(csrf)

        # 1. Localidades iniciales + creación + edición + desactivación
        r_locs = client.get(f'{self.base}/api/localidades')
        self.assertEqual(r_locs.status_code, 200)
        locs = r_locs.json()['items']
        self.assertGreaterEqual(len(locs), 8)
        osorno_id = next(l['id'] for l in locs if l['nombre'] == 'Osorno')
        rio_negro_id = next(l['id'] for l in locs if l['nombre'] == 'Río Negro')

        r_new_loc = client.post(
            f'{self.base}/api/localidades',
            headers=hdrs,
            json={'nombre': 'La Unión', 'region': 'Región de Los Ríos', 'latitud': -40.2931, 'longitud': -73.0819},
        )
        self.assertEqual(r_new_loc.status_code, 201)
        la_union_id = r_new_loc.json()['localidad']['id']

        r_toggle = client.patch(
            f'{self.base}/api/localidades/{la_union_id}/estado',
            headers=hdrs,
            json={'activa': 0},
        )
        self.assertEqual(r_toggle.status_code, 200)
        self.assertEqual(r_toggle.json()['localidad']['activa'], 0)

        # 2. Congregación flexible cubriendo múltiples localidades
        r_cong = client.post(
            f'{self.base}/api/congregaciones',
            headers=hdrs,
            json={
                'nombre': 'Señas Cordillera-Costa',
                'localidad_id': osorno_id,
                'localidades_ids': [osorno_id, rio_negro_id],
                'descripcion': 'Cobertura intercomunal',
            },
        )
        self.assertEqual(r_cong.status_code, 201)
        cong_id = r_cong.json()['congregacion']['id']
        self.assertEqual(len(r_cong.json()['congregacion']['localidades_cubiertas']), 2)

        # 3. Personas: rechazo sin consentimiento
        r_no_consent = client.post(
            f'{self.base}/api/personas',
            headers=hdrs,
            json={'nombre': 'Camila', 'consentimiento_registrado': 0},
        )
        self.assertEqual(r_no_consent.status_code, 400)

        # Persona 1: utiliza LSCh
        r_p1 = client.post(
            f'{self.base}/api/personas',
            headers=hdrs,
            json={
                'nombre': '=Mateo',  # También prueba protección contra CSV injection en exportación
                'apellido': 'Vargas',
                'localidad_id': osorno_id,
                'sector': 'Rahue Alto',
                'congregacion_id': cong_id,
                'medio_comunicacion': 'lsch',
                'usa_lsch': 1,
                'nivel_lsch': 'intermedio',
                'necesita_interpretacion': 1,
                'estado': 'confirmado',
                'consentimiento_registrado': 1,
            },
        )
        self.assertEqual(r_p1.status_code, 201)
        p1 = r_p1.json()['persona']
        self.assertTrue(p1['codigo_interno'].startswith('SC-'))

        # Persona 2: NO utiliza LSCh (prefiere comunicación escrita) y datos parciales
        r_p2 = client.post(
            f'{self.base}/api/personas',
            headers=hdrs,
            json={
                'nombre': 'Elena',
                'localidad_id': rio_negro_id,
                'medio_comunicacion': 'escrito',
                'usa_lsch': 0,
                'prefiere_escrita': 1,
                'necesita_interpretacion': None,
                'estado': 'por_confirmar',
                'consentimiento_registrado': 1,
            },
        )
        self.assertEqual(r_p2.status_code, 201)
        p2 = r_p2.json()['persona']

        # Búsqueda y filtros combinables
        r_search = client.get(f'{self.base}/api/personas?q=Rahue&localidad_id={osorno_id}&estado=confirmado')
        self.assertEqual(r_search.status_code, 200)
        self.assertEqual(r_search.json()['total'], 1)
        self.assertEqual(r_search.json()['items'][0]['id'], p1['id'])

        r_filter_no_lsch = client.get(f'{self.base}/api/personas?usa_lsch=0')
        self.assertEqual(r_filter_no_lsch.json()['total'], 1)
        self.assertEqual(r_filter_no_lsch.json()['items'][0]['id'], p2['id'])

        # 4. Seguimientos y sincronización de última visita
        r_seg = client.post(
            f'{self.base}/api/seguimientos',
            headers=hdrs,
            json={
                'persona_id': p1['id'],
                'tipo': 'visita_realizada',
                'fecha': '2026-11-10',
                'estado': 'completado',
                'descripcion': 'Visita cordial y confirmación de preferencia de horario.',
            },
        )
        self.assertEqual(r_seg.status_code, 201)

        r_p1_detail = client.get(f'{self.base}/api/personas/{p1["id"]}')
        self.assertEqual(r_p1_detail.json()['persona']['fecha_ultima_visita'], '2026-11-10')
        self.assertEqual(len(r_p1_detail.json()['seguimientos']), 1)

        # Seguimiento territorial sin persona asociada
        r_seg_terr = client.post(
            f'{self.base}/api/seguimientos',
            headers=hdrs,
            json={
                'persona_id': None,
                'localidad_id': rio_negro_id,
                'tipo': 'confirmar_info',
                'fecha': '2026-11-15',
                'estado': 'pendiente',
                'descripcion': 'Coordinar visita informativa en sector rural.',
            },
        )
        self.assertEqual(r_seg_terr.status_code, 201)

        # 5. Estadísticas con datos incompletos honestos
        r_stats = client.get(f'{self.base}/api/estadisticas')
        self.assertEqual(r_stats.status_code, 200)
        stats = r_stats.json()
        self.assertEqual(stats['total_personas'], 2)
        interp = stats['comunicacion']['necesita_interpretacion']
        self.assertEqual(interp['si'], 1)
        self.assertEqual(interp['sin_dato'], 1)
        self.assertEqual(interp['con_dato'], 1)
        self.assertEqual(interp['porcentaje_si_informado'], 100.0)  # Sobre 1 informado, no sobre 2!

        # 6. Exportación CSV y JSON
        r_csv = client.get(f'{self.base}/api/respaldos/exportar?formato=csv')
        self.assertEqual(r_csv.status_code, 200)
        csv_text = r_csv.text
        self.assertTrue(csv_text.startswith('\ufeff'))
        self.assertIn("'=Mateo", csv_text)  # Neutralización de fórmula CSV

        r_json = client.get(f'{self.base}/api/respaldos/exportar?formato=json')
        self.assertEqual(r_json.status_code, 200)
        backup = r_json.json()
        self.assertEqual(backup['app'], 'senasconecta')
        self.assertEqual(len(backup['personas']), 2)
        self.assertNotIn('sesiones', backup)

        # 7. Previsualización e importación JSON (prevención de duplicados + rechazo de inválidos)
        backup_mod = json.loads(json.dumps(backup))
        backup_mod['personas'].append({'nombre': '', 'apellido': 'Inválido'})  # Debe rechazarse
        backup_mod['personas'].append({
            'nombre': 'Tomás',
            'apellido': 'Salazar',
            'localidad_nombre': 'Purranque',
            'estado': 'por_confirmar',
            'consentimiento_registrado': 1,
        })

        r_prev = client.post(
            f'{self.base}/api/respaldos/previsualizar',
            headers=hdrs,
            json={'respaldo': backup_mod, 'estrategia_duplicados': 'omitir'},
        )
        self.assertEqual(r_prev.status_code, 200)
        prev = r_prev.json()
        self.assertEqual(prev['resumen']['personas']['nuevos'], 1)
        self.assertEqual(prev['resumen']['personas']['omitidos'], 2)
        self.assertEqual(prev['resumen']['personas']['rechazados'], 1)

        # Verificar que previsualizar NO escribió nada en la BD
        self.assertEqual(client.get(f'{self.base}/api/personas').json()['total'], 2)

        # Importación sin confirmar debe fallar
        r_unconfirmed = client.post(
            f'{self.base}/api/respaldos/importar',
            headers=hdrs,
            json={'respaldo': backup_mod, 'estrategia_duplicados': 'omitir', 'confirmado': False},
        )
        self.assertEqual(r_unconfirmed.status_code, 400)

        # Importación confirmada
        r_imp = client.post(
            f'{self.base}/api/respaldos/importar',
            headers=hdrs,
            json={'respaldo': backup_mod, 'estrategia_duplicados': 'omitir', 'confirmado': True},
        )
        self.assertEqual(r_imp.status_code, 200)
        self.assertEqual(r_imp.json()['resumen']['personas']['nuevos'], 1)
        self.assertEqual(client.get(f'{self.base}/api/personas').json()['total'], 3)

        # 8. Dashboard refleja totales actualizados
        r_dash = client.get(f'{self.base}/api/dashboard')
        self.assertEqual(r_dash.status_code, 200)
        self.assertEqual(r_dash.json()['resumen']['total_personas'], 3)
        self.assertEqual(r_dash.json()['resumen']['seguimientos_pendientes'], 1)

        # 9. Eliminar persona y verificar eliminación en cascada de sus seguimientos
        r_del_p1 = client.delete(f'{self.base}/api/personas/{p1["id"]}', headers=hdrs)
        self.assertEqual(r_del_p1.status_code, 200)
        self.assertEqual(client.get(f'{self.base}/api/personas/{p1["id"]}').status_code, 404)

        client.close()

    def test_06_import_update_strategy_conflict_delete_and_categories(self):
        client, _, _ = self._login_as('admin')
        csrf, _ = self._get_csrf(client)
        hdrs = self._headers(csrf)

        # Crear congregación vinculada a Osorno y persona en esa congregación
        locs = client.get(f'{self.base}/api/localidades').json()['items']
        osorno_id = next(l['id'] for l in locs if l['nombre'] == 'Osorno')

        r_cong = client.post(
            f'{self.base}/api/congregaciones',
            headers=hdrs,
            json={'nombre': 'Congregación Sur', 'localidad_id': osorno_id},
        )
        self.assertEqual(r_cong.status_code, 201)
        cong_id = r_cong.json()['congregacion']['id']

        r_p = client.post(
            f'{self.base}/api/personas',
            headers=hdrs,
            json={
                'nombre': 'Lucía',
                'apellido': 'Méndez',
                'localidad_id': osorno_id,
                'congregacion_id': cong_id,
                'estado': 'por_confirmar',
                'consentimiento_registrado': 1,
            },
        )
        self.assertEqual(r_p.status_code, 201)
        persona = r_p.json()['persona']

        # Eliminar congregación con personas sin force=1 devuelve 409; con force=1 desvincula sin borrar persona
        self.assertEqual(client.delete(f'{self.base}/api/congregaciones/{cong_id}', headers=hdrs).status_code, 409)
        self.assertEqual(client.delete(f'{self.base}/api/congregaciones/{cong_id}?force=1', headers=hdrs).status_code, 200)
        p_after = client.get(f'{self.base}/api/personas/{persona["id"]}').json()['persona']
        self.assertIsNone(p_after['congregacion_id'])

        # Categorías configurables
        r_cat = client.post(
            f'{self.base}/api/configuracion/categorias',
            headers=hdrs,
            json={'grupo': 'medio_comunicacion', 'etiqueta': 'Mensajería visual'},
        )
        self.assertEqual(r_cat.status_code, 201)
        cat_id = r_cat.json()['categoria']['id']
        r_cat_upd = client.put(
            f'{self.base}/api/configuracion/categorias/{cat_id}',
            headers=hdrs,
            json={'etiqueta': 'Mensajería por video'},
        )
        self.assertEqual(r_cat_upd.status_code, 200)
        self.assertEqual(r_cat_upd.json()['categoria']['etiqueta'], 'Mensajería por video')

        # Importación con estrategia 'actualizar'
        backup = client.get(f'{self.base}/api/respaldos/exportar?formato=json').json()
        backup['personas'][0]['estado'] = 'confirmado'
        backup['personas'][0]['sector'] = 'Ovejería'
        r_imp = client.post(
            f'{self.base}/api/respaldos/importar',
            headers=hdrs,
            json={'respaldo': backup, 'estrategia_duplicados': 'actualizar', 'confirmado': True},
        )
        self.assertEqual(r_imp.status_code, 200)
        self.assertEqual(r_imp.json()['resumen']['personas']['modificados'], 1)
        p_updated = client.get(f'{self.base}/api/personas/{persona["id"]}').json()['persona']
        self.assertEqual(p_updated['estado'], 'confirmado')
        self.assertEqual(p_updated['sector'], 'Ovejería')

        client.close()


class CorsAndRateLimitTests(unittest.TestCase):
    def test_cors_and_rate_limit(self):
        stack = LocalTestStack(admin_github_id='100001', disable_rate_limit='0')
        stack.start()
        try:
            client = httpx.Client(timeout=10.0)
            # Preflight permitido
            r_ok = client.options(
                f'{stack.worker_url}/api/personas',
                headers={'Origin': stack.frontend_url, 'Access-Control-Request-Method': 'POST'},
            )
            self.assertEqual(r_ok.status_code, 204)
            self.assertEqual(r_ok.headers.get('Access-Control-Allow-Origin'), stack.frontend_url)
            self.assertEqual(r_ok.headers.get('Access-Control-Allow-Credentials'), 'true')

            # Preflight origen desconocido bloqueado
            r_bad = client.options(
                f'{stack.worker_url}/api/personas',
                headers={'Origin': 'https://unknown.example', 'Access-Control-Request-Method': 'POST'},
            )
            self.assertEqual(r_bad.status_code, 403)

            # Límite de solicitudes en /auth/login (máximo 40 cada 10 min)
            statuses = []
            for _ in range(42):
                r = client.get(f'{stack.worker_url}/auth/login', follow_redirects=False)
                statuses.append(r.status_code)
            self.assertIn(429, statuses)
            client.close()
        finally:
            stack.stop()


if __name__ == '__main__':
    unittest.main(verbosity=2)
