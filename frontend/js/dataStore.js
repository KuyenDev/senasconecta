const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

let publishedSnapshot = null;
let previewSnapshot = null;
let loadPromise = null;

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function asArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function asTriBool(value) {
  if (value === 1 || value === true || value === '1') return 1;
  if (value === 0 || value === false || value === '0') return 0;
  return null;
}

function asCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asSafeHttpUrl(value) {
  const raw = String(value ?? '').trim();
  return /^https?:\/\/\S+$/i.test(raw) ? raw : '';
}

function normalizeSnapshot(raw) {
  const categorias = raw.categorias && typeof raw.categorias === 'object' ? raw.categorias : {};
  const localidades = asArray(raw.localidades).map((loc, idx) => ({
    id: Number(loc.id ?? idx + 1),
    nombre: String(loc.nombre ?? '').trim() || `Localidad ${idx + 1}`,
    region: String(loc.region ?? '').trim(),
    descripcion: String(loc.descripcion ?? '').trim(),
    latitud: asCoord(loc.latitud),
    longitud: asCoord(loc.longitud),
    activa: loc.activa === undefined ? 1 : Number(loc.activa) ? 1 : 0,
    fecha_creacion: loc.fecha_creacion || '',
    fecha_actualizacion: loc.fecha_actualizacion || '',
  }));

  const locById = new Map(localidades.map((loc) => [loc.id, loc]));

  const personas = asArray(raw.personas).map((p, idx) => {
    const locId = p.localidad_id === null || p.localidad_id === undefined || p.localidad_id === '' ? null : Number(p.localidad_id);
    const locObj = locId !== null ? locById.get(locId) : null;
    const id = Number(p.id ?? idx + 1);
    return {
      id,
      codigo_interno: String(p.codigo_interno ?? `SC-${String(id).padStart(4, '0')}`).trim(),
      nombre: String(p.nombre ?? '').trim(),
      apellido: String(p.apellido ?? '').trim(),
      localidad_id: locId,
      localidad_nombre: String(p.localidad_nombre ?? locObj?.nombre ?? '').trim() || 'Sin localidad',
      sector: String(p.sector ?? '').trim(),
      direccion: String(p.direccion ?? '').trim(),
      latitud: asCoord(p.latitud),
      longitud: asCoord(p.longitud),
      mapa_url: asSafeHttpUrl(p.mapa_url),
      fecha_incorporacion: String(p.fecha_incorporacion ?? '').trim(),
      medio_comunicacion: String(p.medio_comunicacion ?? '').trim() || null,
      usa_lsch: asTriBool(p.usa_lsch),
      nivel_lsch: String(p.nivel_lsch ?? '').trim() || null,
      prefiere_escrita: asTriBool(p.prefiere_escrita),
      necesita_interpretacion: asTriBool(p.necesita_interpretacion),
      observaciones_comunicacion: String(p.observaciones_comunicacion ?? '').trim(),
      estado: String(p.estado ?? 'por_confirmar').trim() || 'por_confirmar',
      fecha_ultima_visita: String(p.fecha_ultima_visita ?? '').trim(),
      proxima_accion: String(p.proxima_accion ?? '').trim(),
      observaciones: String(p.observaciones ?? '').trim(),
      consentimiento_registrado: p.consentimiento_registrado ? 1 : 0,
      nota_consentimiento: String(p.nota_consentimiento ?? '').trim(),
      fecha_consentimiento: String(p.fecha_consentimiento ?? '').trim(),
      fecha_dato: String(p.fecha_dato ?? '').trim(),
      archivo_fuente: String(p.archivo_fuente ?? '').trim(),
      fecha_creacion: String(p.fecha_creacion ?? '').trim(),
      fecha_actualizacion: String(p.fecha_actualizacion ?? p.fecha_creacion ?? '').trim(),
    };
  });

  const meta = raw.meta && typeof raw.meta === 'object'
    ? {
        ...raw.meta,
        totales: raw.meta.totales || {
          localidades: localidades.length,
          personas: personas.length,
        },
      }
    : {
        app: 'senasconecta',
        grupo: 'Grupo Señas Osorno',
        ultima_actualizacion: new Date().toISOString(),
        fuentes_excel: [],
        totales: {
          localidades: localidades.length,
          personas: personas.length,
        },
      };

  return { categorias, localidades, personas, meta };
}

async function fetchJson(relativeUrl) {
  let response;
  try {
    response = await fetch(relativeUrl, { cache: 'no-store' });
  } catch (err) {
    if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
      throw new Error(
        'No es posible leer los archivos JSON abriendo el archivo directamente (file://). Usa GitHub Pages, Live Server o "python3 -m http.server".'
      );
    }
    throw new Error(`No se pudo cargar ${relativeUrl}: ${err.message || 'error de red'}`);
  }
  if (!response.ok) {
    throw new Error(`Error al leer ${relativeUrl} (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`El archivo ${relativeUrl} no contiene un JSON válido.`);
  }
}

export async function loadPublishedDataset(forceReload = false) {
  if (publishedSnapshot && !forceReload) {
    return publishedSnapshot;
  }
  if (loadPromise && !forceReload) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const [categorias, localidades, personas, meta] = await Promise.all([
      fetchJson('./data/categorias.json'),
      fetchJson('./data/localidades.json'),
      fetchJson('./data/personas.json'),
      fetchJson('./data/meta.json').catch(() => null),
    ]);
    publishedSnapshot = normalizeSnapshot({
      categorias,
      localidades,
      personas,
      meta,
    });
    return publishedSnapshot;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export async function getActiveDataset(forceReload = false) {
  if (previewSnapshot && !forceReload) {
    return previewSnapshot;
  }
  return await loadPublishedDataset(forceReload);
}

export async function activatePreviewSnapshot(rawBackup, fileName = 'respaldo.json') {
  if (!rawBackup || typeof rawBackup !== 'object' || Array.isArray(rawBackup)) {
    throw new Error('El archivo JSON debe ser un objeto válido exportado por SeñasConecta.');
  }
  if (!Array.isArray(rawBackup.personas) && !Array.isArray(rawBackup.localidades)) {
    throw new Error('El archivo JSON no contiene listas de "personas" ni "localidades".');
  }

  const base = await loadPublishedDataset(false);
  previewSnapshot = normalizeSnapshot({
    categorias: rawBackup.categorias || base.categorias,
    localidades: Array.isArray(rawBackup.localidades) ? rawBackup.localidades : base.localidades,
    personas: Array.isArray(rawBackup.personas) ? rawBackup.personas : [],
    meta: {
      app: 'senasconecta',
      grupo: rawBackup.grupo || 'Grupo Señas Osorno',
      ultima_actualizacion: rawBackup.exportado_en || new Date().toISOString(),
      fuentes_excel: [`Vista previa local: ${fileName}`],
      es_vista_previa: true,
    },
  });
  return previewSnapshot;
}

export async function clearPreviewSnapshot() {
  previewSnapshot = null;
  return await loadPublishedDataset(true);
}

export function isPreviewActive() {
  return Boolean(previewSnapshot);
}

function triMetric(items, field) {
  let si = 0;
  let no = 0;
  for (const item of items) {
    if (item[field] === 1) si += 1;
    else if (item[field] === 0) no += 1;
  }
  const sin_dato = items.length - si - no;
  const total_informado = si + no;
  const porcentaje_si = total_informado > 0 ? Math.round((si / total_informado) * 100) : 0;
  return { si, no, sin_dato, total_informado, porcentaje_si };
}

function countBy(items, keyGetter) {
  const map = new Map();
  for (const item of items) {
    const key = keyGetter(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([clave, total]) => ({ clave, total }))
    .sort((a, b) => b.total - a.total || String(a.clave).localeCompare(String(b.clave), 'es'));
}

function compareValues(a, b, order = 'asc') {
  const dir = order === 'asc' ? 1 : -1;
  const strA = String(a ?? '');
  const strB = String(b ?? '');
  if (!strA && !strB) return 0;
  if (!strA) return 1;
  if (!strB) return -1;
  return strA.localeCompare(strB, 'es', { sensitivity: 'base' }) * dir;
}

function computeLocalidadDetails(loc, personas) {
  const personasLoc = personas.filter((p) => p.localidad_id === loc.id);
  const confirmadosCount = personasLoc.filter((p) => p.estado === 'confirmado').length;

  const sectoresMap = new Map();
  for (const p of personasLoc) {
    const sector = p.sector.trim();
    if (!sector) continue;
    sectoresMap.set(sector, (sectoresMap.get(sector) || 0) + 1);
  }
  const sectores = Array.from(sectoresMap.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));

  return {
    ...loc,
    personas_count: personasLoc.length,
    confirmados_count: confirmadosCount,
    sectores,
  };
}

function csvEscape(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = CSV_FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function buildCsvExport(personas) {
  const headers = [
    'codigo_interno',
    'nombre',
    'apellido',
    'localidad',
    'sector',
    'direccion',
    'latitud',
    'longitud',
    'mapa_url',
    'fecha_incorporacion',
    'medio_comunicacion',
    'usa_lsch',
    'nivel_lsch',
    'prefiere_escrita',
    'necesita_interpretacion',
    'observaciones_comunicacion',
    'estado',
    'fecha_ultima_visita',
    'proxima_accion',
    'observaciones',
    'fecha_actualizacion',
  ];

  const triLabel = (val) => (val === 1 ? 'Sí' : val === 0 ? 'No' : '');
  const lines = [headers.map(csvEscape).join(',')];

  for (const p of personas) {
    const row = [
      p.codigo_interno,
      p.nombre,
      p.apellido,
      p.localidad_nombre,
      p.sector,
      p.direccion,
      p.latitud ?? '',
      p.longitud ?? '',
      p.mapa_url,
      p.fecha_incorporacion,
      p.medio_comunicacion || '',
      triLabel(p.usa_lsch),
      p.nivel_lsch || '',
      triLabel(p.prefiere_escrita),
      triLabel(p.necesita_interpretacion),
      p.observaciones_comunicacion,
      p.estado,
      p.fecha_ultima_visita,
      p.proxima_accion,
      p.observaciones,
      p.fecha_actualizacion,
    ];
    lines.push(row.map(csvEscape).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

export async function queryDataEndpoint(pathWithQuery, options = {}) {
  const dataset = await getActiveDataset();
  const [rawPath, rawQuery = ''] = String(pathWithQuery).split('?');
  const path = rawPath.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(rawQuery);
  const { categorias, localidades, personas, meta } = dataset;

  if (path === '/api/configuracion') {
    return { categorias, localidades, meta };
  }

  if (path === '/api/dashboard') {
    const localidadesActivas = localidades.filter((l) => l.activa === 1);
    const countsByEstado = new Map();
    const countsByLoc = new Map();
    let confirmados = 0;
    let pendientesActualizacion = 0;
    let porConfirmar = 0;
    let requierenVisita = 0;
    let necesitanInterpretacion = 0;
    let usanLsch = 0;
    let prefierenEscrita = 0;
    let conUbicacion = 0;

    for (const p of personas) {
      countsByEstado.set(p.estado, (countsByEstado.get(p.estado) || 0) + 1);
      if (p.localidad_id !== null) {
        countsByLoc.set(p.localidad_id, (countsByLoc.get(p.localidad_id) || 0) + 1);
      }
      if (p.estado === 'confirmado') confirmados += 1;
      if (p.estado === 'pendiente_actualizacion') pendientesActualizacion += 1;
      if (p.estado === 'por_confirmar') porConfirmar += 1;
      if (p.estado === 'requiere_visita') requierenVisita += 1;
      if (p.necesita_interpretacion === 1) necesitanInterpretacion += 1;
      if (p.usa_lsch === 1) usanLsch += 1;
      if (p.prefiere_escrita === 1) prefierenEscrita += 1;
      if (p.latitud !== null && p.longitud !== null) conUbicacion += 1;
    }

    const distribucion_localidades = localidades
      .filter((l) => l.activa === 1 || (countsByLoc.get(l.id) || 0) > 0)
      .map((l) => ({
        id: l.id,
        nombre: l.nombre,
        total: countsByLoc.get(l.id) || 0,
      }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));

    const estadoOrder = asArray(categorias.estado_registro).map((c) => c.clave);
    const distribucion_estados = Array.from(countsByEstado.entries())
      .map(([estado, total]) => ({ estado, total }))
      .sort((a, b) => {
        const ia = estadoOrder.indexOf(a.estado);
        const ib = estadoOrder.indexOf(b.estado);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

    const ultimos_agregados = [...personas]
      .sort((a, b) => compareValues(a.fecha_creacion, b.fecha_creacion, 'desc') || b.id - a.id)
      .slice(0, 5);

    const ultimas_modificaciones = [...personas]
      .sort((a, b) => compareValues(a.fecha_actualizacion, b.fecha_actualizacion, 'desc') || b.id - a.id)
      .slice(0, 5);

    return {
      resumen: {
        total_personas: personas.length,
        total_localidades: localidades.length,
        localidades_activas: localidadesActivas.length,
        confirmados,
        pendientes_actualizacion: pendientesActualizacion,
        por_confirmar: porConfirmar,
        requieren_visita: requierenVisita,
        con_ubicacion: conUbicacion,
        necesitan_interpretacion: necesitanInterpretacion,
        usan_lsch: usanLsch,
        prefieren_escrita: prefierenEscrita,
      },
      distribucion_localidades,
      distribucion_estados,
      ultimos_agregados,
      ultimas_modificaciones,
      meta,
    };
  }

  if (path === '/api/personas') {
    const q = normalizeText(params.get('q'));
    const locIdRaw = params.get('localidad_id');
    const locId = locIdRaw ? Number(locIdRaw) : null;
    const sectorParam = normalizeText(params.get('sector'));
    const estado = params.get('estado') || '';
    const usaLsch = params.get('usa_lsch') || '';
    const sort = params.get('sort') || 'fecha_actualizacion';
    const order = params.get('order') === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, Number(params.get('page') || 1));
    const limit = Math.min(1000, Math.max(1, Number(params.get('limit') || 25)));

    let filtered = personas.filter((p) => {
      if (locId !== null && p.localidad_id !== locId) return false;
      if (sectorParam && normalizeText(p.sector) !== sectorParam) return false;
      if (estado && p.estado !== estado) return false;
      if (usaLsch === '1' && p.usa_lsch !== 1) return false;
      if (usaLsch === '0' && p.usa_lsch !== 0) return false;
      if (usaLsch === 'null' && p.usa_lsch !== null) return false;
      if (q) {
        const haystack = normalizeText(
          `${p.codigo_interno} ${p.nombre} ${p.apellido} ${p.localidad_nombre} ${p.sector} ${p.direccion} ${p.proxima_accion} ${p.observaciones} ${p.archivo_fuente}`
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      switch (sort) {
        case 'nombre':
          return compareValues(a.nombre, b.nombre, order) || compareValues(a.apellido, b.apellido, order);
        case 'apellido':
          return compareValues(a.apellido, b.apellido, order) || compareValues(a.nombre, b.nombre, order);
        case 'localidad':
          return compareValues(a.localidad_nombre, b.localidad_nombre, order) || compareValues(a.nombre, b.nombre, 'asc');
        case 'estado':
          return compareValues(a.estado, b.estado, order) || compareValues(a.nombre, b.nombre, 'asc');
        case 'fecha_creacion':
          return compareValues(a.fecha_creacion, b.fecha_creacion, order) || (b.id - a.id);
        case 'fecha_dato':
          return compareValues(a.fecha_dato, b.fecha_dato, order) || (b.id - a.id);
        case 'fecha_ultima_visita':
        case 'ultima_visita':
          return compareValues(a.fecha_ultima_visita, b.fecha_ultima_visita, order) || (b.id - a.id);
        case 'fecha_actualizacion':
        default:
          return compareValues(a.fecha_actualizacion, b.fecha_actualizacion, order) || (b.id - a.id);
      }
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit),
      total,
      page,
      limit,
    };
  }

  const personaMatch = path.match(/^\/api\/personas\/(\d+)$/);
  if (personaMatch) {
    const id = Number(personaMatch[1]);
    const persona = personas.find((p) => p.id === id);
    if (!persona) {
      throw new Error('No se encontró la persona solicitada.');
    }
    return { persona };
  }

  if (path === '/api/localidades') {
    const includeInactive = params.get('incluir_inactivas') === '1' || params.get('incluir_inactivas') === 'true';
    const items = localidades
      .filter((l) => includeInactive || l.activa === 1)
      .map((l) => computeLocalidadDetails(l, personas))
      .sort((a, b) => b.activa - a.activa || a.nombre.localeCompare(b.nombre, 'es'));
    return { items };
  }

  const locMatch = path.match(/^\/api\/localidades\/(\d+)$/);
  if (locMatch) {
    const id = Number(locMatch[1]);
    const loc = localidades.find((l) => l.id === id);
    if (!loc) {
      throw new Error('No se encontró la localidad solicitada.');
    }
    const locPersonas = personas
      .filter((p) => p.localidad_id === id)
      .sort((a, b) => compareValues(a.nombre, b.nombre, 'asc') || compareValues(a.apellido, b.apellido, 'asc'));
    return {
      localidad: computeLocalidadDetails(loc, personas),
      personas: locPersonas,
    };
  }

  if (path === '/api/estadisticas') {
    const por_localidad = localidades
      .filter((l) => l.activa === 1 || personas.some((p) => p.localidad_id === l.id))
      .map((l) => {
        const list = personas.filter((p) => p.localidad_id === l.id);
        return {
          id: l.id,
          nombre: l.nombre,
          total: list.length,
          total_personas: list.length,
          confirmados: list.filter((p) => p.estado === 'confirmado').length,
          pendientes: list.filter((p) => p.estado === 'pendiente_actualizacion' || p.estado === 'por_confirmar').length,
          usan_lsch: list.filter((p) => p.usa_lsch === 1).length,
          necesitan_interpretacion: list.filter((p) => p.necesita_interpretacion === 1).length,
        };
      })
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));

    return {
      total_personas: personas.length,
      estados_registro: {
        confirmados: personas.filter((p) => p.estado === 'confirmado').length,
        pendientes_actualizacion: personas.filter((p) => p.estado === 'pendiente_actualizacion').length,
        por_confirmar: personas.filter((p) => p.estado === 'por_confirmar').length,
        requieren_visita: personas.filter((p) => p.estado === 'requiere_visita').length,
        inactivos: personas.filter((p) => p.estado === 'inactivo').length,
      },
      comunicacion: {
        usa_lsch: triMetric(personas, 'usa_lsch'),
        prefiere_escrita: triMetric(personas, 'prefiere_escrita'),
        necesita_interpretacion: triMetric(personas, 'necesita_interpretacion'),
        medios: countBy(personas, (p) => p.medio_comunicacion),
        niveles_lsch: countBy(personas, (p) => p.nivel_lsch),
      },
      por_localidad,
    };
  }

  if (path === '/api/respaldos/exportar') {
    const formato = params.get('formato') === 'json' ? 'json' : 'csv';
    const content =
      formato === 'json'
        ? JSON.stringify(
            {
              version: '2.0-estatico',
              app: 'senasconecta',
              grupo: meta?.grupo || 'Grupo Señas Osorno',
              exportado_en: new Date().toISOString(),
              localidades,
              personas,
            },
            null,
            2
          )
        : buildCsvExport(personas);

    const mime = formato === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
    const blob = typeof Blob === 'function' ? new Blob([content], { type: mime }) : { content, type: mime };
    if (options.rawResponse) {
      return {
        ok: true,
        status: 200,
        async blob() {
          return blob;
        },
        async text() {
          return content;
        },
      };
    }
    return { content, mime };
  }

  throw new Error(`Consulta no disponible en la versión estática (${path}).`);
}
