/**
 * Prueba End-to-End del frontend estático de SeñasConecta (app.js + todas las vistas)
 * servido sobre HTTP sin backend, consumiendo archivos JSON en ./data/.
 */

import './install_globals.mjs';
import GLib from 'gi://GLib';

const frontendUrl = GLib.getenv('FRONTEND_URL');
const testScenario = GLib.getenv('TEST_SCENARIO') || 'excel_populated';

function assert(cond, msg) {
  if (!cond) throw new Error(`E2E Assertion failed: ${msg}`);
}

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
  appendChild(child) {
    if (child.parentNode && child.parentNode !== this) {
      child.parentNode.removeChild(child);
    }
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
  set textContent(v) {
    this.childNodes = [];
    if (v !== null && v !== undefined && String(v) !== '') {
      const tn = new MockNode(3, String(v));
      tn.parentNode = this;
      this.childNodes.push(tn);
    }
  }
}

class MockElement extends MockNode {
  constructor(tagName) {
    super(1, '');
    this.tagName = String(tagName || 'div').toUpperCase();
    this.classList = new MockClassList(this);
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._listeners = new Map();
    this._value = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
  }
  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur === body) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  get id() {
    return this.attributes.id || '';
  }
  set id(v) {
    this.attributes.id = String(v);
  }
  get className() {
    return this.classList.toString();
  }
  set className(v) {
    this.classList._syncFromAttr(v);
  }
  get type() {
    return this.attributes.type || '';
  }
  set type(v) {
    this.attributes.type = String(v);
  }
  get children() {
    return this.childNodes.filter((c) => c instanceof MockElement);
  }
  get options() {
    return this._walk((el) => el.tagName === 'OPTION');
  }
  get value() {
    if (this.tagName === 'SELECT') {
      if (this._value) return this._value;
      const sel = this.options.find((o) => o.selected);
      if (sel) return sel.value;
      return this.options[0]?.value ?? '';
    }
    return this._value;
  }
  set value(v) {
    this._value = String(v ?? '');
    if (this.tagName === 'SELECT') {
      for (const opt of this.options) {
        opt.selected = opt.value === this._value;
      }
    }
  }
  setAttribute(k, v) {
    const str = String(v);
    this.attributes[k] = str;
    if (k === 'class') this.classList._syncFromAttr(str);
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[camel] = str;
    }
  }
  getAttribute(k) {
    return this.attributes[k] ?? null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (arr) this._listeners.set(type, arr.filter((f) => f !== fn));
  }
  dispatchEvent(ev) {
    const event = { target: this, currentTarget: this, preventDefault() {}, ...ev };
    for (const fn of this._listeners.get(event.type) || []) {
      fn(event);
    }
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
  querySelectorAll(selector) {
    const parts = selector.split(',').map((s) => s.trim());
    return this._walk((el) =>
      parts.some((sel) => {
        if (sel === '.nav-item[data-route]') {
          return el.classList.contains('nav-item') && Boolean(el.dataset.route);
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
  'static-sidebar-panel',
  'data-updated-hint',
  'dataset-pill',
  'btn-refresh-view',
  'preview-status-banner',
  'preview-banner-text',
  'btn-exit-preview',
  'page-title',
  'page-subtitle',
  'main-content',
  'modal-root',
  'toast-region',
];

const idMap = new Map();
for (const id of elementIds) {
  const el = new MockElement(id.startsWith('btn-') ? 'button' : 'div');
  el.setAttribute('id', id);
  if (id === 'app-shell' || id === 'modal-root' || id === 'preview-status-banner' || id === 'sidebar-backdrop') {
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

globalThis.Node = MockNode;
globalThis.Element = MockElement;
globalThis.HTMLElement = MockElement;

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

globalThis.location = {
  get href() {
    return currentHref;
  },
  set href(v) {
    currentHref = v;
  },
  get protocol() {
    return new URL(currentHref).protocol;
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
};

globalThis.addEventListener = (t, fn) => {
  if (!winListeners.has(t)) winListeners.set(t, []);
  winListeners.get(t).push(fn);
};

let lastCreatedBlob = null;
const capturedBlobs = [];
globalThis.Blob = class {
  constructor(parts, opts = {}) {
    this.parts = parts;
    this.type = opts.type || '';
  }
  async text() {
    return this.parts.map((p) => String(p)).join('');
  }
};
globalThis.URL.createObjectURL = (blob) => {
  lastCreatedBlob = blob;
  capturedBlobs.push(blob);
  return `blob:mock/${capturedBlobs.length}`;
};
globalThis.URL.revokeObjectURL = () => {};

globalThis.setTimeout = (fn, ms) =>
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms || 1), () => {
    fn();
    return GLib.SOURCE_REMOVE;
  });
globalThis.clearTimeout = (id) => {
  if (id) GLib.source_remove(id);
};

const flush = (ms = 90) =>
  new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });

async function nav(route) {
  const btn = idMap
    .get('app-sidebar')
    .querySelectorAll('.nav-item[data-route]')
    .find((b) => b.dataset.route === route);
  assert(btn, `Missing nav item ${route}`);
  btn.click();
  await flush(110);
}

async function runScenario() {
  await import('../../frontend/js/app.js');
  await flush(150);

  assert(!idMap.get('app-shell').classList.contains('hidden'), 'App shell visible directly without login');
  assert(idMap.get('boot-screen').classList.contains('hidden'), 'Boot screen hidden after load');
  assert(!document.getElementById('btn-github-login'), 'No GitHub login button exists');
  assert(!document.getElementById('btn-quick-new-person'), 'No write shortcut button exists');
  assert(idMap.get('dataset-pill').textContent === 'Datos JSON', 'Dataset pill displays Datos JSON');

  const mainEl = idMap.get('main-content');

  if (testScenario === 'empty_published') {
    const dashText = mainEl.textContent;
    assert(dashText.includes('Personas registradas'), 'Dashboard shows Personas registradas card');
    assert(dashText.includes('Territorio sin personas registradas'), 'Dashboard shows empty territory message');
    assert(dashText.includes('8'), 'Dashboard shows 8 initial localidades');

    await nav('territorio');
    const terrText = mainEl.textContent;
    assert(terrText.includes('Osorno'), 'Territorio lists Osorno');
    assert(terrText.includes('Río Bueno'), 'Territorio lists Río Bueno');
    assert(!terrText.includes('+ Nueva localidad'), 'Territorio is clean static consultation');

    await nav('estadisticas');
    assert(mainEl.textContent.includes('Aún no hay suficientes registros'), 'Estadisticas shows empty notice cleanly');

    print('E2E_EMPTY_PUBLISHED_OK');
    return;
  }

  if (testScenario === 'excel_populated') {
    const dashText = mainEl.textContent;
    assert(dashText.includes('Utilizan LSCh'), 'Dashboard renders LSCh summary card');
    assert(dashText.includes('Sofía Cárdenas'), 'Dashboard recent entries show Sofía Cárdenas');
    assert(idMap.get('data-updated-hint').textContent.includes('2 persona(s)'), 'Sidebar shows 2 personas loaded');

    // Navegar a Personas y probar búsqueda sin tildes + ficha modal de solo lectura
    await nav('personas');
    const searchInput = mainEl.querySelector('#filter-q');
    assert(searchInput, 'Search input present');
    searchInput.value = 'Rio';
    searchInput.dispatchEvent({ type: 'input' });
    await flush(320);
    assert(mainEl.textContent.includes('Mateo Paredes'), 'Accent-insensitive search finds Mateo Paredes in Río Bueno');
    assert(!mainEl.textContent.includes('Sofía Cárdenas'), 'Search filters out non-matching persona');

    searchInput.value = 'Rahue';
    searchInput.dispatchEvent({ type: 'input' });
    await flush(320);
    assert(mainEl.textContent.includes('Sofía Cárdenas'), 'Sector search finds Sofía Cárdenas');

    const viewBtn = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Ver ficha');
    assert(viewBtn, 'Ver ficha button exists');
    viewBtn.click();
    await flush(100);
    const modalRoot = idMap.get('modal-root');
    const modalText = modalRoot.textContent;
    assert(!modalRoot.classList.contains('hidden'), 'Detail modal opens');
    assert(modalText.includes('Sofía Cárdenas'), 'Modal shows person name');
    assert(modalText.includes('Lengua de Señas Chilena (LSCh)'), 'Modal shows communication method');
    assert(modalText.includes('Coordinar intérprete'), 'Modal shows linked seguimiento');
    assert(!modalText.includes('Editar') && !modalText.includes('Eliminar'), 'Modal has zero mutation buttons');
    modalRoot.querySelectorAll('button').find((b) => b.textContent === 'Cerrar').click();
    await flush(60);

    // Localidades y sectores
    await nav('territorio');
    assert(mainEl.textContent.includes('Rahue Bajo (1)'), 'Localidad table shows sector chip Rahue Bajo (1)');
    const consultBtn = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Consultar');
    assert(consultBtn, 'Consultar localidad button exists');
    consultBtn.click();
    await flush(90);
    assert(modalRoot.textContent.includes('Localidad'), 'Localidad detail modal opened');
    modalRoot.querySelectorAll('button').find((b) => b.textContent === 'Ver en Personas').click();
    await flush(110);
    assert(idMap.get('page-title').textContent.includes('Registro de personas'), 'Ver en Personas navigates back to Personas');

    // Seguimientos
    await nav('seguimientos');
    assert(mainEl.textContent.includes('Coordinar intérprete'), 'Seguimientos lists imported seguimiento');

    // Mapa territorial
    await nav('mapa');
    assert(mainEl.textContent.includes('Rahue Bajo (1)'), 'Mapa lists sector chips');
    assert(!mainEl.textContent.includes('Definir centro'), 'Mapa has no admin coordinate edit buttons');

    // Estadísticas
    await nav('estadisticas');
    const statsText = mainEl.textContent;
    assert(statsText.includes('Detalle por localidad'), 'Estadisticas shows Detalle por localidad');
    assert(statsText.includes('50%'), 'Estadisticas computes 1 de 2 (50%) using LSCh');
    assert(!statsText.includes('NaN'), 'No NaN in Estadisticas');
    assert(!statsText.includes('Detalle por congregación'), 'No congregación table rendered');

    // Exportar y datos: CSV (con neutralización de fórmula) + JSON + Vista previa local
    await nav('respaldos');
    const btnCsv = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Descargar CSV (Excel)');
    assert(btnCsv, 'CSV download button exists');
    btnCsv.click();
    await flush(80);
    assert(lastCreatedBlob, 'CSV blob created');
    const csvText = await lastCreatedBlob.text();
    assert(csvText.startsWith('\uFEFF'), 'CSV includes UTF-8 BOM');
    assert(csvText.includes('Sofía'), 'CSV contains Sofía');
    assert(csvText.includes("'=SUM(A1)"), 'CSV neutralizes formula injection prefix');

    const btnJson = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Descargar base JSON');
    assert(btnJson, 'JSON download button exists');
    btnJson.click();
    await flush(80);
    const jsonText = await lastCreatedBlob.text();
    const parsedExport = JSON.parse(jsonText);
    assert(parsedExport.personas.length === 2, 'Exported JSON contains 2 personas');

    // Probar vista previa local de JSON
    const previewInput = mainEl.querySelector('#preview-json-file');
    assert(previewInput, 'Preview file input exists');
    const modifiedBackup = {
      ...parsedExport,
      personas: [
        ...parsedExport.personas,
        {
          id: 99,
          codigo_interno: 'SC-0099',
          nombre: 'Lucía',
          apellido: 'Preview',
          localidad_id: 1,
          estado: 'confirmado',
          usa_lsch: 1,
        },
      ],
    };
    previewInput.files = [
      {
        name: 'respaldo_preview.json',
        async text() {
          return JSON.stringify(modifiedBackup);
        },
      },
    ];
    const btnPreview = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Previsualizar respaldo JSON');
    btnPreview.click();
    await flush(110);
    assert(!idMap.get('preview-status-banner').classList.contains('hidden'), 'Preview banner becomes visible');
    assert(idMap.get('dataset-pill').textContent === 'Vista previa local', 'Topbar pill marks preview mode');

    await nav('dashboard');
    assert(mainEl.textContent.includes('Lucía Preview'), 'Dashboard reflects local preview persona');

    idMap.get('btn-exit-preview').click();
    await flush(110);
    assert(idMap.get('preview-status-banner').classList.contains('hidden'), 'Preview banner hidden after restore');
    assert(!mainEl.textContent.includes('Lucía Preview'), 'Dashboard returns to published JSON data');

    print('E2E_EXCEL_POPULATED_OK');
    return;
  }

  throw new Error(`Unknown scenario: ${testScenario}`);
}

const loop = new GLib.MainLoop(null, false);
let exitCode = 0;

runScenario()
  .catch((err) => {
    exitCode = 1;
    console.error(err);
  })
  .finally(() => {
    loop.quit();
  });

loop.run();
imports.system.exit(exitCode);
