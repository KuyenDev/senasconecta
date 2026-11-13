/**
 * Prueba end-to-end que ejecuta el frontend JS real (app.js + todas las vistas y componentes)
 * contra el Worker real (worker/src/index.js) y SQLite sobre HTTP con manejo real de cookies.
 */

import './install_globals.mjs';
import GLib from 'gi://GLib';

const workerUrl = GLib.getenv('WORKER_URL');
const frontendUrl = GLib.getenv('FRONTEND_URL');
const authCookieHeader = GLib.getenv('AUTH_COOKIE') || '';
const testScenario = GLib.getenv('TEST_SCENARIO') || 'full';

function assert(cond, msg) {
  if (!cond) throw new Error(`E2E Assertion failed: ${msg}`);
}

// Implementación fiel mínima de DOM en memoria para ejercitar app.js y todas las vistas
class MockClassList {
  constructor(el) {
    this._el = el;
    this._set = new Set();
  }
  _syncFromAttr(cls) {
    this._set = new Set(String(cls || '').split(/\s+/).filter(Boolean));
  }
  add(...names) {
    for (const n of names) this._set.add(n);
  }
  remove(...names) {
    for (const n of names) this._set.delete(n);
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this._set.has(name)) this._set.delete(name);
      else this._set.add(name);
    } else if (force) {
      this._set.add(name);
    } else {
      this._set.delete(name);
    }
  }
  contains(name) {
    return this._set.has(name);
  }
  toString() {
    return Array.from(this._set).join(' ');
  }
}

class MockNode {
  constructor(nodeType = 1, text = '') {
    this.nodeType = nodeType;
    this._text = text;
    this.parentNode = null;
    this.childNodes = [];
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur === globalThis.document.body || cur === globalThis.document.head) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  get textContent() {
    if (this.nodeType === 3) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(val) {
    if (this.nodeType === 3) {
      this._text = String(val ?? '');
    } else {
      this.childNodes = [];
      if (val !== undefined && val !== null && String(val) !== '') {
        const txt = new MockNode(3, String(val));
        txt.parentNode = this;
        this.childNodes.push(txt);
      }
    }
  }
}

globalThis.Node = MockNode;

class MockElement extends MockNode {
  constructor(tagName) {
    super(1);
    this.tagName = String(tagName).toUpperCase();
    this.classList = new MockClassList(this);
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this._listeners = new Map();
    this._value = '';
    this.checked = false;
    this.disabled = false;
    this.selected = false;
    this.id = '';
    this.type = '';
    this.name = '';
    this.href = '';
    this.download = '';
    this.files = [];
  }
  get value() {
    if (this.tagName === 'SELECT') {
      const opts = this.querySelectorAll('option');
      const selected = opts.find((o) => o.selected) || opts[0];
      return selected ? String(selected._value ?? '') : '';
    }
    return this._value;
  }
  set value(val) {
    const str = String(val ?? '');
    this._value = str;
    if (this.tagName === 'SELECT') {
      const opts = this.querySelectorAll('option');
      for (const o of opts) {
        o.selected = String(o._value ?? '') === str;
      }
    }
  }
  set className(val) {
    this.classList._syncFromAttr(val);
  }
  get className() {
    return this.classList.toString();
  }
  setAttribute(name, value) {
    const k = String(name);
    const v = String(value);
    this.attributes.set(k, v);
    if (k === 'id') this.id = v;
    if (k === 'class') this.className = v;
    if (k === 'type') this.type = v;
    if (k === 'name') this.name = v;
    if (k === 'value') this.value = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;
  }
  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }
  removeAttribute(name) {
    this.attributes.delete(String(name));
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (!arr) return;
    this._listeners.set(type, arr.filter((f) => f !== fn));
  }
  dispatchEvent(evt) {
    evt.target = evt.target || this;
    evt.currentTarget = this;
    evt.preventDefault = evt.preventDefault || (() => {});
    const arr = this._listeners.get(evt.type) || [];
    for (const fn of [...arr]) fn(evt);
  }
  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  scrollIntoView() {}
  _walk(pred, acc = []) {
    for (const c of this.childNodes) {
      if (c instanceof MockElement) {
        if (pred(c)) acc.push(c);
        c._walk(pred, acc);
      }
    }
    return acc;
  }
  _hasAncestorClass(el, className) {
    let cur = el.parentNode;
    while (cur && cur !== this) {
      if (cur.classList && cur.classList.contains(className)) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  querySelectorAll(selector) {
    const parts = selector.split(',').map((s) => s.trim());
    return this._walk((el) =>
      parts.some((sel) => {
        if (sel === '.nav-item[data-route]') {
          return el.classList.contains('nav-item') && Boolean(el.dataset.route);
        }
        if (sel === '.checkbox-grid input[type="checkbox"]:checked') {
          return el.tagName === 'INPUT' && el.type === 'checkbox' && el.checked && this._hasAncestorClass(el, 'checkbox-grid');
        }
        if (sel.includes('.') && !sel.startsWith('.')) {
          const [tag, cls] = sel.split('.');
          return el.tagName === tag.toUpperCase() && el.classList.contains(cls);
        }
        if (sel.startsWith('#')) return el.id === sel.slice(1);
        if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
        return el.tagName === sel.toUpperCase();
      })
    );
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

const body = new MockElement('body');
const head = new MockElement('head');
const docListeners = new Map();

const elementIds = [
  'boot-screen',
  'app-shell',
  'sidebar-backdrop',
  'app-sidebar',
  'btn-close-sidebar',
  'btn-open-sidebar',
  'guest-sidebar-panel',
  'admin-sidebar-panel',
  'btn-github-login',
  'btn-topbar-login',
  'readonly-pill',
  'btn-logout',
  'btn-refresh-view',
  'btn-quick-new-person',
  'auth-status-banner',
  'auth-banner-text',
  'btn-close-auth-banner',
  'page-title',
  'page-subtitle',
  'main-content',
  'modal-root',
  'toast-region',
  'sidebar-admin-info',
  'admin-avatar',
  'admin-display-name',
  'admin-login-handle',
  'session-expiry-hint',
];

const idMap = new Map();
for (const id of elementIds) {
  const el = new MockElement(id.startsWith('btn-') ? 'button' : 'div');
  el.setAttribute('id', id);
  if (
    id === 'app-shell' ||
    id === 'modal-root' ||
    id === 'auth-status-banner' ||
    id === 'sidebar-backdrop' ||
    id === 'admin-sidebar-panel' ||
    id === 'btn-quick-new-person'
  ) {
    el.classList.add('hidden');
  }
  body.appendChild(el);
  idMap.set(id, el);
}

for (const route of ['dashboard', 'personas', 'territorio', 'seguimientos', 'mapa', 'estadisticas', 'respaldos']) {
  const btn = new MockElement('button');
  btn.className = 'nav-item';
  btn.setAttribute('data-route', route);
  idMap.get('app-sidebar').appendChild(btn);
}

globalThis.document = {
  title: 'SeñasConecta',
  head,
  body,
  activeElement: null,
  createElement: (tag) => new MockElement(tag),
  createTextNode: (t) => new MockNode(3, String(t)),
  getElementById: (id) => {
    if (idMap.has(id)) return idMap.get(id);
    return body._walk((el) => el.id === id)[0] || null;
  },
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  addEventListener: (t, fn) => {
    if (!docListeners.has(t)) docListeners.set(t, []);
    docListeners.get(t).push(fn);
  },
  removeEventListener: (t, fn) => {
    const arr = docListeners.get(t);
    if (arr) docListeners.set(t, arr.filter((f) => f !== fn));
  },
};

let currentHref = GLib.getenv('INITIAL_HREF') || `${frontendUrl}/`;
const winListeners = new Map();
let lastRedirect = null;

globalThis.location = {
  get href() {
    return currentHref;
  },
  set href(v) {
    currentHref = v;
  },
  get hostname() {
    return new URL(currentHref).hostname;
  },
  get port() {
    return new URL(currentHref).port;
  },
  get hash() {
    return new URL(currentHref).hash;
  },
  set hash(v) {
    const u = new URL(currentHref);
    u.hash = v ? (v.startsWith('#') ? v : `#${v}`) : '';
    currentHref = u.toString();
  },
  assign(url) {
    lastRedirect = url;
  },
};

globalThis.history = {
  replaceState(_s, _t, pathAndMore) {
    const u = new URL(currentHref);
    currentHref = `${u.origin}${pathAndMore}`;
  },
};

globalThis.addEventListener = (t, fn) => {
  if (!winListeners.has(t)) winListeners.set(t, []);
  winListeners.get(t).push(fn);
};

globalThis.SENASCONECTA_API_URL = testScenario === 'backend_unreachable' ? '' : workerUrl;

let simulateOffline = testScenario === 'backend_unreachable';
let capturedFetchUrls = [];
const baseFetch = globalThis.fetch;
let activeCookie = authCookieHeader;
globalThis.fetch = async (url, init = {}) => {
  capturedFetchUrls.push(String(url));
  if (simulateOffline) {
    throw new Error('Connection refused');
  }
  const headers = new globalThis.Headers(init.headers || {});
  headers.set('Origin', frontendUrl);
  if (activeCookie) headers.set('Cookie', activeCookie);
  const res = await baseFetch(url, { ...init, headers });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    if (sc.includes('Max-Age=0')) activeCookie = '';
    else activeCookie = sc.split(';')[0];
  }
  return res;
};

globalThis.Blob = class {
  constructor(parts) {
    this.parts = parts;
  }
};
globalThis.URL.createObjectURL = () => 'blob:mock';
globalThis.URL.revokeObjectURL = () => {};
globalThis.setTimeout = (fn, ms) => {
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms || 1), () => {
    fn();
    return GLib.SOURCE_REMOVE;
  });
  return id;
};
globalThis.clearTimeout = (id) => {
  if (id) GLib.source_remove(id);
};

const flush = (ms = 80) =>
  new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });

async function runScenario() {
  await import('../../frontend/js/app.js');
  await flush(150);

  if (testScenario === 'backend_unreachable') {
    assert(!idMap.get('app-shell').classList.contains('hidden'), 'App shell visible when offline');
    assert(capturedFetchUrls.some((u) => u.startsWith('http://127.0.0.1:8787/')), 'Live Server :5500 auto-targets local Worker :8787');
    assert(idMap.get('auth-status-banner').classList.contains('hidden'), 'No duplicate top error banner when offline card is shown');
    assert(idMap.get('main-content').querySelector('#backend-offline-card'), 'Single backend offline card shown');
    assert(idMap.get('main-content').textContent.includes('python3 scripts/dev_local.py'), 'Offline card shows local run command');
    assert(!idMap.get('main-content').textContent.includes('Ocurrió un error al procesar'), 'No generic Live Server 404 alert');

    simulateOffline = false;
    globalThis.SENASCONECTA_API_URL = workerUrl;
    const retryBtn = idMap.get('main-content').querySelectorAll('button').find((b) => b.textContent === 'Reintentar conexión');
    assert(retryBtn, 'Retry button present on offline card');
    retryBtn.click();
    await flush(180);
    assert(!idMap.get('main-content').querySelector('#backend-offline-card'), 'Offline card removed after recovery');
    assert(idMap.get('main-content').textContent.includes('Utilizan LSCh'), 'Dashboard recovers on retry');
    print('E2E_BACKEND_UNREACHABLE_OK');
    return;
  }

  if (testScenario === 'unauth') {
    assert(!idMap.get('app-shell').classList.contains('hidden'), 'App shell visible directly for visitor');
    assert(!idMap.get('guest-sidebar-panel').classList.contains('hidden'), 'Guest sidebar login panel visible');
    assert(idMap.get('admin-sidebar-panel').classList.contains('hidden'), 'Admin sidebar hidden');
    assert(!idMap.get('readonly-pill').classList.contains('hidden'), 'Read-only pill visible');
    assert(idMap.get('btn-quick-new-person').classList.contains('hidden'), 'Quick add hidden for visitor');
    assert(idMap.get('main-content').textContent.includes('Localidades'), 'Visitor sees dashboard');
    assert(idMap.get('main-content').textContent.includes('Utilizan LSCh'), 'Dashboard shows LSCh card');
    assert(idMap.get('main-content').textContent.includes('Estado de los registros'), 'Dashboard shows register status chart');
    assert(!idMap.get('main-content').textContent.includes('Distribución por congregación'), 'No congregation chart in Grupo Señas Osorno UI');

    const dashBtns = idMap.get('main-content').querySelectorAll('button').map((b) => b.textContent);
    assert(!dashBtns.some((t) => t.includes('Registrar primera persona') || t.includes('+ Seguimiento')), 'No mutation buttons on dashboard');

    const btnTerr = idMap.get('app-sidebar').querySelectorAll('.nav-item[data-route]').find((b) => b.dataset.route === 'territorio');
    btnTerr.click();
    await flush(150);
    assert(idMap.get('main-content').textContent.includes('Osorno'), 'Visitor sees Osorno in Territorio');
    const terrBtns = idMap.get('main-content').querySelectorAll('button').map((b) => b.textContent);
    assert(!terrBtns.includes('Congregaciones'), 'Congregaciones tab removed in Territorio');
    assert(terrBtns.includes('Consultar'), 'Consultar available for visitor');
    assert(!terrBtns.some((t) => ['Editar', 'Eliminar', '+ Nueva localidad'].includes(t)), 'No edit buttons in Territorio for visitor');

    idMap.get('btn-github-login').click();
    assert(lastRedirect === `${workerUrl}/auth/login`, 'Login button redirects to Worker /auth/login');
    print('E2E_UNAUTH_OK');
    return;
  }

  if (testScenario === 'unauthorized_feedback') {
    assert(!idMap.get('app-shell').classList.contains('hidden'), 'App shell remains usable on auth_error');
    assert(!idMap.get('auth-status-banner').classList.contains('hidden'), 'Banner visible on auth_error');
    assert(idMap.get('auth-banner-text').textContent.includes('Acceso denegado'), 'Shows denied message');
    print('E2E_UNAUTHORIZED_FEEDBACK_OK');
    return;
  }

  if (testScenario === 'cookie_blocked') {
    assert(!idMap.get('app-shell').classList.contains('hidden'), 'App shell remains usable on blocked cookie');
    assert(!idMap.get('auth-status-banner').classList.contains('hidden'), 'Banner visible on blocked cookie');
    assert(idMap.get('auth-banner-text').textContent.includes('cookie'), 'Shows cookie blocked warning');
    print('E2E_COOKIE_BLOCKED_OK');
    return;
  }

  if (testScenario === 'readonly_browse') {
    assert(!idMap.get('app-shell').classList.contains('hidden'), 'App shell visible for read-only visitor');
    assert(idMap.get('btn-quick-new-person').classList.contains('hidden'), 'Quick add hidden');
    assert(idMap.get('main-content').textContent.includes('Sofía Cárdenas'), 'Visitor sees Sofía Cárdenas on dashboard');

    const modalRoot = idMap.get('modal-root');
    const go = async (route) => {
      const btn = idMap.get('app-sidebar').querySelectorAll('.nav-item[data-route]').find((b) => b.dataset.route === route);
      btn.click();
      await flush(160);
    };

    await go('personas');
    assert(idMap.get('main-content').textContent.includes('Sofía Cárdenas'), 'Visitor sees Sofía in Personas');
    const perBtns = idMap.get('main-content').querySelectorAll('button').map((b) => b.textContent);
    assert(!perBtns.some((t) => ['+ Nueva persona', 'Editar', 'Eliminar'].includes(t)), 'No person edit buttons for visitor');

    const btnFicha = idMap.get('main-content').querySelectorAll('button').find((b) => b.textContent === 'Ver ficha');
    btnFicha.click();
    await flush(150);
    assert(modalRoot.textContent.includes('Rahue Bajo'), 'Visitor opens ficha modal');
    assert(modalRoot.textContent.includes('Coordinar visita inicial de apoyo'), 'Visitor reads follow-up history in ficha');
    const modalBtns = modalRoot.querySelectorAll('button').map((b) => b.textContent);
    assert(!modalBtns.some((t) => ['Editar', 'Eliminar', '+ Nuevo seguimiento'].includes(t)), 'Ficha modal hides admin actions');
    modalRoot.querySelectorAll('button').find((b) => b.textContent === 'Cerrar').click();
    await flush(30);

    await go('territorio');
    assert(idMap.get('main-content').textContent.includes('Frutillar'), 'Visitor sees Frutillar');
    await go('seguimientos');
    assert(idMap.get('main-content').textContent.includes('Coordinar visita inicial de apoyo'), 'Visitor sees follow-up');
    const segBtns = idMap.get('main-content').querySelectorAll('button').map((b) => b.textContent);
    assert(!segBtns.some((t) => ['Completar', 'Editar', 'Eliminar', '+ Nuevo seguimiento'].includes(t)), 'Seguimientos hides admin actions');

    await go('mapa');
    assert(idMap.get('main-content').textContent.includes('Rahue Bajo'), 'Visitor sees sector in Mapa');
    const mapBtns = idMap.get('main-content').querySelectorAll('button').map((b) => b.textContent);
    assert(!mapBtns.some((t) => t.includes('Definir centro') || t.includes('Ajustar centro')), 'Mapa hides admin coordinate editor');

    await go('estadisticas');
    assert(idMap.get('main-content').textContent.includes('Preferencias de comunicación'), 'Visitor sees Estadísticas');

    await go('respaldos');
    assert(idMap.get('main-content').textContent.includes('Acceso administrativo requerido'), 'Respaldos prompts admin login for visitor');
    print('E2E_READONLY_BROWSE_OK');
    return;
  }

  // Escenario completo autenticado
  assert(!idMap.get('app-shell').classList.contains('hidden'), 'Authenticated app shell visible');
  assert(!idMap.get('admin-sidebar-panel').classList.contains('hidden'), 'Admin sidebar visible');
  assert(idMap.get('guest-sidebar-panel').classList.contains('hidden'), 'Guest sidebar hidden');
  assert(idMap.get('readonly-pill').classList.contains('hidden'), 'Read-only pill hidden');
  assert(!idMap.get('btn-quick-new-person').classList.contains('hidden'), 'Quick add visible for admin');
  assert(idMap.get('admin-login-handle').textContent === '@admin-senas', 'Admin handle rendered');
  assert(idMap.get('main-content').textContent.includes('Localidades'), 'Dashboard shows Localidades');

  // Abrir modal de Nueva persona desde topbar y enviar formulario
  idMap.get('btn-quick-new-person').click();
  await flush(30);
  const modalRoot = idMap.get('modal-root');
  assert(!modalRoot.classList.contains('hidden'), 'Modal opened');
  const form = modalRoot.querySelector('#person-form');
  assert(form, 'Person form present');
  assert(!modalRoot.querySelector('#p-congregacion'), 'Congregation field removed from Person form UI');

  modalRoot.querySelector('#p-nombre').value = 'Sofía';
  modalRoot.querySelector('#p-apellido').value = 'Cárdenas';
  const locSelect = modalRoot.querySelector('#p-localidad');
  const firstLocOpt = locSelect.querySelectorAll('option').find((o) => o.value);
  locSelect.value = firstLocOpt.value;
  modalRoot.querySelector('#p-sector').value = 'Rahue Bajo';
  modalRoot.querySelector('#p-usa-lsch').value = '0';
  modalRoot.querySelector('#p-escrita').value = '1';
  modalRoot.querySelector('#p-estado').value = 'confirmado';
  modalRoot.querySelector('#p-consent').checked = true;

  form.dispatchEvent({ type: 'submit', target: form });
  await flush(150);
  assert(modalRoot.classList.contains('hidden'), 'Modal closed after saving person');

  // Navegar a Localidades y sectores y crear localidad mediante el modal real
  const btnTerr = idMap.get('app-sidebar').querySelectorAll('.nav-item[data-route]').find((b) => b.dataset.route === 'territorio');
  btnTerr.click();
  await flush(150);
  assert(idMap.get('main-content').textContent.includes('Osorno'), 'Territorio shows Osorno');
  assert(idMap.get('main-content').textContent.includes('Rahue Bajo'), 'Territorio shows registered sector Rahue Bajo');
  assert(!idMap.get('main-content').querySelectorAll('button').some((b) => b.textContent === 'Congregaciones'), 'Congregaciones tab hidden');

  const btnNewLoc = idMap.get('main-content').querySelectorAll('button').find((b) => b.textContent.includes('+ Nueva localidad'));
  btnNewLoc.click();
  await flush(40);
  const locForm = modalRoot.querySelector('#loc-form');
  assert(locForm, 'Localidad form opened');
  modalRoot.querySelector('#l-nombre').value = 'Frutillar';
  modalRoot.querySelector('#l-region').value = 'Región de Los Lagos';
  locForm.dispatchEvent({ type: 'submit', target: locForm });
  await flush(160);
  assert(idMap.get('main-content').textContent.includes('Frutillar'), 'Frutillar created and displayed');

  // Ir a Personas, abrir ficha, crear seguimiento desde la ficha, buscar y filtrar
  const btnPer = idMap.get('app-sidebar').querySelectorAll('.nav-item[data-route]').find((b) => b.dataset.route === 'personas');
  btnPer.click();
  await flush(150);
  assert(idMap.get('main-content').textContent.includes('Sofía Cárdenas'), 'Personas table shows Sofía Cárdenas');
  assert(!idMap.get('main-content').querySelector('#filter-cong'), 'Congregation filter removed from Personas UI');
  assert(!idMap.get('main-content').textContent.includes('Sin congregación'), 'No Sin congregación cell in Personas table');

  const btnFicha = idMap.get('main-content').querySelectorAll('button').find((b) => b.textContent === 'Ver ficha');
  btnFicha.click();
  await flush(150);
  assert(modalRoot.textContent.includes('Rahue Bajo'), 'Ficha modal shows Rahue Bajo');
  assert(!modalRoot.textContent.includes('Congregación'), 'Ficha omits empty congregation row');

  const btnAddSeg = modalRoot.querySelectorAll('button').find((b) => b.textContent.includes('+ Nuevo seguimiento'));
  btnAddSeg.click();
  await flush(150);
  const segForm = modalRoot.querySelector('#seg-form');
  assert(segForm, 'Seguimiento form opened from ficha');
  modalRoot.querySelector('#s-desc').value = 'Coordinar visita inicial de apoyo';
  segForm.dispatchEvent({ type: 'submit', target: segForm });
  await flush(180);

  // Cerrar modal de ficha si permanece abierto
  const closeFicha = modalRoot.querySelectorAll('button').find((b) => b.textContent === 'Cerrar');
  if (closeFicha) closeFicha.click();
  await flush(40);

  // Probar filtro de búsqueda en Personas
  const filterQ = idMap.get('main-content').querySelector('#filter-q');
  filterQ.value = 'Rahue';
  filterQ.dispatchEvent({ type: 'input', target: filterQ });
  await flush(320);
  assert(idMap.get('main-content').textContent.includes('Sofía Cárdenas'), 'Search finds Sofía');

  // Navegar por Seguimientos, Mapa, Estadísticas, Respaldos y Dashboard
  for (const route of ['seguimientos', 'mapa', 'estadisticas', 'respaldos', 'dashboard']) {
    const btn = idMap.get('app-sidebar').querySelectorAll('.nav-item[data-route]').find((b) => b.dataset.route === route);
    btn.click();
    await flush(150);
    const contentText = idMap.get('main-content').textContent;
    if (route === 'seguimientos') {
      assert(contentText.includes('Coordinar visita inicial de apoyo'), 'Seguimientos shows created follow-up');
      const btnComp = idMap.get('main-content').querySelectorAll('button').find((b) => b.textContent === 'Completar');
      if (btnComp) {
        btnComp.click();
        await flush(150);
      }
    }
    if (route === 'mapa') assert(contentText.includes('Rahue Bajo'), 'Mapa territorial shows sector Rahue Bajo');
    if (route === 'estadisticas') {
      assert(contentText.includes('Preferencias de comunicación'), 'Estadísticas renders');
      assert(!contentText.includes('Detalle por congregación'), 'No empty congregation stats table shown');
    }
    if (route === 'respaldos') assert(contentText.includes('Exportar respaldos locales'), 'Respaldos renders');
    if (route === 'dashboard') {
      assert(contentText.includes('Sofía Cárdenas'), 'Dashboard shows recent addition');
      assert(contentText.includes('Rahue Bajo'), 'Dashboard shows sector in recent addition');
      assert(!contentText.includes('Sin congregación'), 'Dashboard hides Sin congregación text');
    }
  }

  // Cerrar sesión desde botón real y confirmar retorno automático a modo solo lectura
  idMap.get('btn-logout').click();
  await flush(180);
  assert(!idMap.get('app-shell').classList.contains('hidden'), 'App shell remains open in read-only after logout');
  assert(!idMap.get('guest-sidebar-panel').classList.contains('hidden'), 'Guest sidebar restored on logout');
  assert(idMap.get('admin-sidebar-panel').classList.contains('hidden'), 'Admin sidebar hidden on logout');
  assert(idMap.get('btn-quick-new-person').classList.contains('hidden'), 'Quick add hidden after logout');
  assert(!idMap.get('readonly-pill').classList.contains('hidden'), 'Read-only pill visible after logout');
  print('E2E_FULL_APP_OK');
}

import System from 'system';
const loop = new GLib.MainLoop(null, false);
runScenario()
  .then(() => loop.quit())
  .catch((err) => {
    printerr('E2E_ERR:', err, err?.stack);
    loop.quit();
    System.exit(1);
  });
loop.run();
