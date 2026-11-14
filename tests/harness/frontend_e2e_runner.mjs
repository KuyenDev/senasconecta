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
  'offline-pill',
  'dataset-pill',
  'btn-update-app',
  'btn-install-topbar',
  'btn-install-app',
  'btn-refresh-view',
  'preview-status-banner',
  'preview-banner-text',
  'btn-exit-preview',
  'page-title',
  'page-subtitle',
  'main-content',
  'mobile-bottom-nav',
  'modal-root',
  'toast-region',
];

const idMap = new Map();
for (const id of elementIds) {
  const el = new MockElement(id.startsWith('btn-') ? 'button' : 'div');
  el.setAttribute('id', id);
  if (
    id === 'app-shell' ||
    id === 'modal-root' ||
    id === 'preview-status-banner' ||
    id === 'sidebar-backdrop' ||
    id === 'offline-pill' ||
    id === 'btn-update-app' ||
    id === 'btn-install-topbar' ||
    id === 'btn-install-app'
  ) {
    el.classList.add('hidden');
  }
  body.appendChild(el);
  idMap.set(id, el);
}

for (const route of ['dashboard', 'personas', 'territorio', 'mapa', 'estadisticas', 'respaldos']) {
  const btn = new MockElement('button');
  btn.className = 'nav-item';
  btn.setAttribute('data-route', route);
  idMap.get('app-sidebar').appendChild(btn);
}

for (const route of ['dashboard', 'personas', 'mapa', 'territorio', 'respaldos']) {
  const mBtn = new MockElement('button');
  mBtn.className = 'mobile-nav-item';
  mBtn.setAttribute('data-route', route);
  idMap.get('mobile-bottom-nav').appendChild(mBtn);
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
  dispatchEvent: (ev) => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...ev,
    };
    for (const fn of docListeners.get(event.type) || []) {
      fn(event);
    }
    return !event.defaultPrevented;
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
globalThis.dispatchEvent = (ev) => {
  for (const fn of winListeners.get(ev.type) || []) {
    fn(ev);
  }
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
    assert(dashText.includes('3'), 'Dashboard shows 3 initial localidades');

    await nav('territorio');
    const terrText = mainEl.textContent;
    assert(terrText.includes('Osorno'), 'Territorio lists Osorno');
    assert(terrText.includes('Río Negro'), 'Territorio lists Río Negro');
    assert(terrText.includes('San Pablo'), 'Territorio lists San Pablo');
    assert(!terrText.includes('Purranque') && !terrText.includes('Río Bueno'), 'Only confirmed localidades are shown');
    assert(!terrText.includes('+ Nueva localidad'), 'Territorio is clean static consultation');

    await nav('estadisticas');
    assert(mainEl.textContent.includes('Aún no hay suficientes registros'), 'Estadisticas shows empty notice cleanly');

    print('E2E_EMPTY_PUBLISHED_OK');
    return;
  }

  if (testScenario === 'excel_populated') {
    const dashText = mainEl.textContent;
    assert(dashText.includes('Utilizan LSCh'), 'Dashboard renders LSCh summary card');
    assert(dashText.includes('Con ubicación en mapa'), 'Dashboard shows Con ubicación en mapa card');
    assert(!dashText.includes('Seguimientos pendientes'), 'Dashboard removes Seguimientos pendientes card');
    assert(dashText.includes('Sofía Cárdenas'), 'Dashboard recent entries show Sofía Cárdenas');
    assert(idMap.get('data-updated-hint').textContent.includes('2 persona(s)'), 'Sidebar shows 2 personas loaded');

    // Navegar a Personas y probar búsqueda sin tildes, ordenamiento y ficha modal de solo lectura
    await nav('personas');
    const searchInput = mainEl.querySelector('#filter-q');
    assert(searchInput, 'Search input present');
    searchInput.value = 'Rio';
    searchInput.dispatchEvent({ type: 'input' });
    await flush(320);
    assert(mainEl.textContent.includes('Mateo Paredes'), 'Accent-insensitive search finds Mateo Paredes in Río Negro');
    assert(!mainEl.textContent.includes('Sofía Cárdenas'), 'Search filters out non-matching persona');

    searchInput.value = 'Rahue';
    searchInput.dispatchEvent({ type: 'input' });
    await flush(320);
    assert(mainEl.textContent.includes('Sofía Cárdenas'), 'Sector search finds Sofía Cárdenas');
    assert(mainEl.textContent.includes('Av. República 410'), 'Personas table shows person address for easy review');
    const rowMapsLink = Array.from(mainEl.querySelectorAll('a')).find((a) => a.textContent === 'Maps');
    assert(rowMapsLink && (rowMapsLink.getAttribute('href') || '').startsWith('https://www.google.com/maps'), 'Personas table includes quick Maps action');

    const btnPersonasXlsxSimple = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Descargar Excel simple');
    assert(btnPersonasXlsxSimple, 'Personas view includes Descargar Excel simple button');
    btnPersonasXlsxSimple.click();
    await flush(80);
    assert(lastCreatedBlob && lastCreatedBlob.parts?.[0]?.[0] === 0x50 && lastCreatedBlob.parts[0][1] === 0x4b, 'Filtered simplified Excel is valid PK zip binary');
    print(`XLSX_FILTERED_SIMPLE_B64:${GLib.base64_encode(lastCreatedBlob.parts[0])}`);

    // Probar ordenamiento por fecha_dato y estado
    const sortSelect = mainEl.querySelector('#filter-sort');
    assert(sortSelect && sortSelect.options.some((o) => o.value === 'fecha_dato'), 'Personas includes fecha_dato sort option');
    sortSelect.value = 'estado';
    sortSelect.dispatchEvent({ type: 'change' });
    await flush(80);
    assert(mainEl.textContent.includes('Sofía Cárdenas'), 'Personas sort by estado renders cleanly');

    const viewBtn = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Ver ficha');
    assert(viewBtn, 'Ver ficha button exists');
    viewBtn.click();
    await flush(100);
    const modalRoot = idMap.get('modal-root');
    const modalText = modalRoot.textContent;
    assert(!modalRoot.classList.contains('hidden'), 'Detail modal opens');
    assert(modalText.includes('Sofía Cárdenas'), 'Modal shows person name');
    assert(modalText.includes('Av. República 410'), 'Modal shows person direccion');
    assert(modalText.includes('Lengua de Señas Chilena (LSCh)'), 'Modal shows communication method');
    assert(modalText.includes('Notas, fechas y origen del dato'), 'Modal shows Notas, fechas y origen del dato section');
    assert(!modalText.includes('Historial de seguimientos'), 'Modal removes Historial de seguimientos section');
    const modalMapsLink = Array.from(modalRoot.querySelectorAll('a')).find((a) => a.textContent === 'Abrir en Google Maps');
    assert(modalMapsLink && (modalMapsLink.getAttribute('href') || '').startsWith('https://www.google.com/maps'), 'Modal shows safe Google Maps link');
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

    // Mapa territorial
    await nav('mapa');
    const mapText = mainEl.textContent;
    assert(mapText.includes('Rahue Bajo (1)'), 'Mapa lists sector chips');
    assert(mapText.includes('1 personas con marcador en el mapa'), 'Mapa reports person marker count');
    assert(mapText.includes('Av. República 410'), 'Mapa lists person direccion');
    const gmapsLink = Array.from(mainEl.querySelectorAll('a')).find((a) => a.textContent === 'Google Maps');
    assert(gmapsLink && (gmapsLink.getAttribute('href') || '').startsWith('https://www.google.com/maps'), 'Mapa includes Google Maps direct action');
    assert(!mapText.includes('Definir centro'), 'Mapa has no admin coordinate edit buttons');

    // Probar extender/contraer y ocultar/mostrar mapa
    const btnExpand = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Extender mapa');
    const btnCollapse = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Ocultar mapa');
    assert(btnExpand && btnCollapse, 'Mapa includes Extender mapa and Ocultar mapa buttons');
    const mapCard = btnExpand.parentNode.parentNode.parentNode;
    const mapCardBody = mainEl.querySelector('#leaflet-map-host').parentNode;
    btnExpand.click();
    await flush(30);
    assert(mapCard.classList.contains('map-card-expanded'), 'Extender mapa activates expanded card class');
    assert(document.body.classList.contains('map-expanded-open'), 'Body locks scroll when map is expanded');
    assert(btnExpand.textContent === 'Contraer mapa', 'Expand button toggles to Contraer mapa');
    btnExpand.click();
    await flush(30);
    assert(!mapCard.classList.contains('map-card-expanded'), 'Contraer mapa returns map to normal size');
    assert(!document.body.classList.contains('map-expanded-open'), 'Body releases scroll after Contraer mapa');
    assert(btnExpand.textContent === 'Extender mapa', 'Expand button toggles back to Extender mapa');
    btnExpand.click();
    await flush(30);
    btnCollapse.click();
    await flush(30);
    assert(!mapCard.classList.contains('map-card-expanded'), 'Ocultar mapa exits expanded state automatically');
    assert(mapCardBody.classList.contains('hidden'), 'Ocultar mapa hides map card body');
    assert(btnCollapse.textContent === 'Mostrar mapa', 'Collapse button switches to Mostrar mapa');
    assert(btnExpand.classList.contains('hidden'), 'Extender button hidden while map collapsed');
    btnCollapse.click();
    await flush(30);
    assert(!mapCardBody.classList.contains('hidden'), 'Mostrar mapa restores map card body');
    assert(btnCollapse.textContent === 'Ocultar mapa', 'Collapse button switches back to Ocultar mapa');
    assert(!btnExpand.classList.contains('hidden'), 'Extender button restores when map reopened');

    // Filtrar en Mapa por Río Negro (Mateo sin coordenadas) -> contador debe actualizar a 0 marcadores
    const mapFilterLoc = mainEl.querySelector('#map-filter-loc');
    const rioOpt = mapFilterLoc.options.find((o) => o.textContent.includes('Río Negro'));
    mapFilterLoc.value = rioOpt.value;
    mapFilterLoc.dispatchEvent({ type: 'change' });
    await flush(60);
    assert(mainEl.textContent.includes('0 personas con marcador en el mapa'), 'Mapa filter updates marker count');

    // Estadísticas
    await nav('estadisticas');
    const statsText = mainEl.textContent;
    assert(statsText.includes('Detalle por localidad'), 'Estadisticas shows Detalle por localidad');
    assert(statsText.includes('50%'), 'Estadisticas computes 1 de 2 (50%) using LSCh');
    assert(!statsText.includes('NaN'), 'No NaN in Estadisticas');
    assert(!statsText.includes('Detalle por congregación'), 'No congregación table rendered');

    // Exportar y datos: Excel simplificado + Excel completo + CSV (con neutralización de fórmula) + JSON + Vista previa local
    await nav('respaldos');
    const btnXlsxSimple = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Descargar Excel simplificado (.xlsx)');
    assert(btnXlsxSimple, 'Simplified Excel download button exists');
    btnXlsxSimple.click();
    await flush(80);
    assert(lastCreatedBlob && lastCreatedBlob.parts?.[0]?.[0] === 0x50 && lastCreatedBlob.parts[0][1] === 0x4b, 'Simplified XLSX starts with PK signature');
    print(`XLSX_FULL_SIMPLE_B64:${GLib.base64_encode(lastCreatedBlob.parts[0])}`);

    const btnXlsxFull = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Descargar Excel completo (.xlsx)');
    assert(btnXlsxFull, 'Complete Excel download button exists');
    btnXlsxFull.click();
    await flush(80);
    assert(lastCreatedBlob && lastCreatedBlob.parts?.[0]?.[0] === 0x50 && lastCreatedBlob.parts[0][1] === 0x4b, 'Complete XLSX starts with PK signature');
    print(`XLSX_COMPLETE_B64:${GLib.base64_encode(lastCreatedBlob.parts[0])}`);

    const btnCsv = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Descargar CSV');
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

  if (testScenario === 'live_published') {
    const dashText = mainEl.textContent;
    assert(dashText.includes('Personas registradas'), 'Dashboard shows Personas registradas card');
    assert(dashText.includes('Con ubicación en mapa'), 'Dashboard shows Con ubicación en mapa card');
    assert(!dashText.includes('Seguimientos pendientes'), 'Dashboard no longer shows Seguimientos pendientes');
    assert(dashText.includes('72'), 'Dashboard shows 72 imported personas');
    assert(idMap.get('data-updated-hint').textContent.includes('72 persona(s)'), 'Sidebar shows 72 personas loaded');

    await nav('territorio');
    const terrText = mainEl.textContent;
    for (const loc of ['Osorno', 'Río Negro', 'San Pablo', 'Purranque', 'Francke', 'Ovejería']) {
      assert(terrText.includes(loc), `Territorio includes ${loc}`);
    }

    await nav('personas');
    const searchInput = mainEl.querySelector('#filter-q');
    searchInput.value = 'Eduardo';
    searchInput.dispatchEvent({ type: 'input' });
    await flush(320);
    assert(mainEl.textContent.includes('Eduardo Javier'), 'Personas search finds imported person from KML');
    assert(!mainEl.textContent.includes('Historial de seguimientos'), 'Personas view omits seguimientos');
    const btnLiveSimple = mainEl.querySelectorAll('button').find((b) => b.textContent === 'Descargar Excel simple');
    assert(btnLiveSimple, 'Live Personas view includes Descargar Excel simple button');
    btnLiveSimple.click();
    await flush(80);
    assert(lastCreatedBlob && lastCreatedBlob.parts?.[0]?.[0] === 0x50 && lastCreatedBlob.parts[0][1] === 0x4b, 'Live filtered simplified Excel is valid PK zip binary');
    print(`XLSX_LIVE_SIMPLE_B64:${GLib.base64_encode(lastCreatedBlob.parts[0])}`);

    await nav('mapa');
    const mapText = mainEl.textContent;
    assert(mapText.includes('72 personas con marcador en el mapa'), 'Mapa loads all 72 person markers');
    assert(!mapText.includes('seg. pendientes'), 'Mapa omits seg. pendientes count');
    assert(!mapText.includes('NaN'), 'No NaN in live Mapa');

    // Probar barra inferior móvil PWA e instalación beforeinstallprompt
    const mobileRespaldos = idMap
      .get('mobile-bottom-nav')
      .querySelectorAll('.mobile-nav-item')
      .find((b) => b.dataset.route === 'respaldos');
    assert(mobileRespaldos, 'Mobile bottom nav includes respaldos tab');
    mobileRespaldos.click();
    await flush(90);
    assert(idMap.get('page-title').textContent.includes('Exportar y datos'), 'Mobile bottom nav navigates to Exportar y datos');
    assert(mobileRespaldos.classList.contains('active'), 'Mobile bottom nav marks active route');

    let promptCalled = false;
    globalThis.dispatchEvent({
      type: 'beforeinstallprompt',
      preventDefault() {},
      async prompt() {
        promptCalled = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    assert(!idMap.get('btn-install-topbar').classList.contains('hidden'), 'Install topbar button reveals on beforeinstallprompt');
    assert(!idMap.get('btn-install-app').classList.contains('hidden'), 'Install sidebar button reveals on beforeinstallprompt');
    idMap.get('btn-install-topbar').click();
    await flush(30);
    assert(promptCalled, 'Install button triggers deferred prompt()');
    assert(idMap.get('btn-install-topbar').classList.contains('hidden'), 'Install buttons hide after prompt acceptance');

    // Probar bloqueo de arrastre de imágenes, selección y copiado de texto
    const textTarget = new MockElement('p');
    const imgTarget = new MockElement('img');
    const inputTarget = new MockElement('input');
    for (const evType of ['dragstart', 'selectstart', 'copy', 'cut', 'contextmenu']) {
      assert(!document.dispatchEvent({ type: evType, target: textTarget }), `${evType} prevented on text element`);
    }
    assert(!document.dispatchEvent({ type: 'dragstart', target: imgTarget }), 'dragstart prevented on image');
    assert(!document.dispatchEvent({ type: 'keydown', key: 'c', ctrlKey: true, target: textTarget }), 'Ctrl+C prevented on text');
    assert(!document.dispatchEvent({ type: 'keydown', key: 'a', metaKey: true, target: textTarget }), 'Cmd+A prevented on text');
    assert(document.dispatchEvent({ type: 'selectstart', target: inputTarget }), 'selectstart allowed inside search input');
    assert(document.dispatchEvent({ type: 'copy', target: inputTarget }), 'copy allowed inside search input');
    assert(document.dispatchEvent({ type: 'keydown', key: 'c', ctrlKey: true, target: inputTarget }), 'Ctrl+C allowed inside search input');

    let selectionCleared = false;
    globalThis.getSelection = () => ({
      isCollapsed: false,
      anchorNode: textTarget,
      removeAllRanges() {
        selectionCleared = true;
      },
    });
    document.dispatchEvent({ type: 'selectionchange' });
    assert(selectionCleared, 'selectionchange clears non-editable text selection');

    print('E2E_LIVE_PUBLISHED_OK');
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
