/**
 * Validación y saneamiento estricto de entradas para todos los módulos de SeñasConecta.
 */

import { parsePositiveId, todayDate } from './utils.js';

export function cleanText(value, maxLen = 500) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  if (trimmed.length > maxLen) return { error: `El campo supera el límite de ${maxLen} caracteres.` };
  return trimmed;
}

export function parseIsoDate(value, fieldLabel = 'fecha') {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: `La ${fieldLabel} debe tener formato YYYY-MM-DD.` };
  }
  const str = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) {
    return { ok: false, error: `La ${fieldLabel} debe tener formato YYYY-MM-DD.` };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() + 1 !== month ||
    dt.getUTCDate() !== day
  ) {
    return { ok: false, error: `La ${fieldLabel} indicada no es una fecha válida.` };
  }
  return { ok: true, value: str };
}

export function parseNullableTriBool(value, fieldLabel = 'campo') {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return { ok: true, value: 1 };
  }
  if (value === false || value === 0 || value === '0' || value === 'false') {
    return { ok: true, value: 0 };
  }
  return { ok: false, error: `El valor de ${fieldLabel} no es válido.` };
}

export function parseBoolFlag(value, defaultValue = 1) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: defaultValue };
  }
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return { ok: true, value: 1 };
  }
  if (value === false || value === 0 || value === '0' || value === 'false') {
    return { ok: true, value: 0 };
  }
  return { ok: false, error: 'El indicador de estado activo debe ser verdadero o falso.' };
}

function readTextField(body, key, maxLen, label) {
  const res = cleanText(body[key], maxLen);
  if (res === null) {
    return { ok: false, error: `El campo "${label}" debe ser texto válido.` };
  }
  if (typeof res === 'object' && res.error) {
    return { ok: false, error: `${label}: ${res.error}` };
  }
  return { ok: true, value: res };
}

export function validateLocalidadPayload(body, isUpdate = false) {
  const errors = [];
  const data = {};

  if (!isUpdate || body.nombre !== undefined) {
    const nombre = readTextField(body, 'nombre', 100, 'Nombre de localidad');
    if (!nombre.ok) errors.push(nombre.error);
    else if (!nombre.value) errors.push('El nombre de la localidad es obligatorio.');
    else data.nombre = nombre.value;
  }

  if (!isUpdate || body.region !== undefined) {
    const region = readTextField(body, 'region', 100, 'Región');
    if (!region.ok) errors.push(region.error);
    else data.region = region.value;
  }

  if (!isUpdate || body.descripcion !== undefined) {
    const desc = readTextField(body, 'descripcion', 500, 'Descripción');
    if (!desc.ok) errors.push(desc.error);
    else data.descripcion = desc.value;
  }

  if (!isUpdate || body.activa !== undefined) {
    const activa = parseBoolFlag(body.activa, 1);
    if (!activa.ok) errors.push(activa.error);
    else data.activa = activa.value;
  }

  const hasLat = body.latitud !== undefined && body.latitud !== null && body.latitud !== '';
  const hasLng = body.longitud !== undefined && body.longitud !== null && body.longitud !== '';

  if (body.latitud !== undefined || body.longitud !== undefined) {
    if (hasLat !== hasLng) {
      errors.push('Si ingresas coordenadas referenciales de la localidad, debes indicar tanto latitud como longitud.');
    } else if (!hasLat && !hasLng) {
      data.latitud = null;
      data.longitud = null;
    } else {
      const lat = Number(body.latitud);
      const lng = Number(body.longitud);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        errors.push('La latitud debe ser un número entre -90 y 90.');
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        errors.push('La longitud debe ser un número entre -180 y 180.');
      }
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        // Redondeo suave a 4 decimales (~11 m) adecuado para centros referenciales de localidad, nunca domicilios.
        data.latitud = Math.round(lat * 10000) / 10000;
        data.longitud = Math.round(lng * 10000) / 10000;
      }
    }
  } else if (!isUpdate) {
    data.latitud = null;
    data.longitud = null;
  }

  return { ok: errors.length === 0, errors, data };
}

export function validateCongregacionPayload(body, isUpdate = false) {
  const errors = [];
  const data = {};

  if (!isUpdate || body.nombre !== undefined) {
    const nombre = readTextField(body, 'nombre', 120, 'Nombre de congregación');
    if (!nombre.ok) errors.push(nombre.error);
    else if (!nombre.value) errors.push('El nombre de la congregación es obligatorio.');
    else data.nombre = nombre.value;
  }

  if (!isUpdate || body.localidad_id !== undefined) {
    if (body.localidad_id === null || body.localidad_id === '' || body.localidad_id === undefined) {
      data.localidad_id = null;
    } else {
      const id = parsePositiveId(body.localidad_id);
      if (!id) errors.push('La localidad principal indicada no es válida.');
      else data.localidad_id = id;
    }
  }

  if (body.localidades_ids !== undefined) {
    if (!Array.isArray(body.localidades_ids)) {
      errors.push('La lista de localidades asociadas debe ser un arreglo.');
    } else {
      const uniqueIds = [];
      const seen = new Set();
      for (const rawId of body.localidades_ids) {
        const parsed = parsePositiveId(rawId);
        if (!parsed) {
          errors.push('Una de las localidades asociadas no tiene un identificador válido.');
          break;
        }
        if (!seen.has(parsed)) {
          seen.add(parsed);
          uniqueIds.push(parsed);
        }
      }
      data.localidades_ids = uniqueIds;
    }
  } else if (!isUpdate) {
    data.localidades_ids = data.localidad_id ? [data.localidad_id] : [];
  }

  if (!isUpdate || body.descripcion !== undefined) {
    const desc = readTextField(body, 'descripcion', 500, 'Descripción');
    if (!desc.ok) errors.push(desc.error);
    else data.descripcion = desc.value;
  }

  if (!isUpdate || body.activa !== undefined) {
    const activa = parseBoolFlag(body.activa, 1);
    if (!activa.ok) errors.push(activa.error);
    else data.activa = activa.value;
  }

  return { ok: errors.length === 0, errors, data };
}

export function validatePersonaPayload(body, categories, options = {}) {
  const { isUpdate = false, requireConsent = true } = options;
  const errors = [];
  const data = {};

  if (!isUpdate || body.nombre !== undefined) {
    const nombre = readTextField(body, 'nombre', 120, 'Nombre');
    if (!nombre.ok) errors.push(nombre.error);
    else if (!nombre.value) errors.push('El nombre es obligatorio para identificar el registro.');
    else data.nombre = nombre.value;
  }

  const textFields = [
    ['apellido', 120, 'Apellido'],
    ['sector', 160, 'Sector o barrio'],
    ['observaciones_comunicacion', 1500, 'Observaciones de comunicación'],
    ['proxima_accion', 300, 'Próxima acción pendiente'],
    ['observaciones', 2000, 'Observaciones'],
    ['nota_consentimiento', 400, 'Nota de consentimiento'],
  ];

  for (const [key, maxLen, label] of textFields) {
    if (!isUpdate || body[key] !== undefined) {
      const res = readTextField(body, key, maxLen, label);
      if (!res.ok) errors.push(res.error);
      else data[key] = res.value;
    }
  }

  for (const fk of ['localidad_id', 'congregacion_id']) {
    if (!isUpdate || body[fk] !== undefined) {
      if (body[fk] === null || body[fk] === '' || body[fk] === undefined) {
        data[fk] = null;
      } else {
        const id = parsePositiveId(body[fk]);
        if (!id) errors.push(`El campo ${fk === 'localidad_id' ? 'localidad' : 'congregación'} no es válido.`);
        else data[fk] = id;
      }
    }
  }

  for (const [dateKey, label] of [
    ['fecha_incorporacion', 'fecha de incorporación'],
    ['fecha_ultima_visita', 'fecha de última visita'],
    ['fecha_consentimiento', 'fecha de consentimiento'],
  ]) {
    if (!isUpdate || body[dateKey] !== undefined) {
      const parsed = parseIsoDate(body[dateKey], label);
      if (!parsed.ok) errors.push(parsed.error);
      else data[dateKey] = parsed.value;
    }
  }

  for (const [boolKey, label] of [
    ['usa_lsch', 'utiliza LSCh'],
    ['prefiere_escrita', 'prefiere comunicación escrita'],
    ['necesita_interpretacion', 'necesita interpretación'],
  ]) {
    if (!isUpdate || body[boolKey] !== undefined) {
      const parsed = parseNullableTriBool(body[boolKey], label);
      if (!parsed.ok) errors.push(parsed.error);
      else data[boolKey] = parsed.value;
    }
  }

  // Medio de comunicación preferido (opcional)
  if (!isUpdate || body.medio_comunicacion !== undefined) {
    const medio = readTextField(body, 'medio_comunicacion', 80, 'Medio de comunicación');
    if (!medio.ok) {
      errors.push(medio.error);
    } else if (medio.value && categories.medio_comunicacion && !categories.medio_comunicacion.has(medio.value)) {
      errors.push('El medio de comunicación seleccionado no es válido.');
    } else {
      data.medio_comunicacion = medio.value;
    }
  }

  // Nivel de LSCh (solo cuando corresponda, opcional)
  if (!isUpdate || body.nivel_lsch !== undefined) {
    const nivel = readTextField(body, 'nivel_lsch', 80, 'Nivel de LSCh');
    if (!nivel.ok) {
      errors.push(nivel.error);
    } else if (nivel.value && categories.nivel_lsch && !categories.nivel_lsch.has(nivel.value)) {
      errors.push('El nivel de LSCh seleccionado no es válido.');
    } else {
      data.nivel_lsch = nivel.value;
    }
  }

  // Coherencia respetuosa: si explícitamente no usa LSCh (0), nivel_lsch queda vacío o 'no_aplica'
  if (data.usa_lsch === 0 && data.nivel_lsch && data.nivel_lsch !== 'no_aplica') {
    data.nivel_lsch = 'no_aplica';
  }

  // Estado del registro
  if (!isUpdate || body.estado !== undefined) {
    const estado = readTextField(body, 'estado', 80, 'Estado del registro');
    if (!estado.ok) {
      errors.push(estado.error);
    } else {
      const finalEstado = estado.value || 'por_confirmar';
      if (categories.estado_registro && !categories.estado_registro.has(finalEstado)) {
        errors.push('El estado del registro seleccionado no es válido.');
      } else {
        data.estado = finalEstado;
      }
    }
  }

  // Consentimiento para incorporar datos personales
  if (!isUpdate || body.consentimiento_registrado !== undefined) {
    const flag = parseBoolFlag(body.consentimiento_registrado, 0);
    if (!flag.ok) {
      errors.push('El estado de consentimiento debe ser válido.');
    } else {
      if (!isUpdate && requireConsent && flag.value !== 1) {
        errors.push('Debes confirmar que se cuenta con consentimiento adecuado para registrar los datos personales.');
      }
      data.consentimiento_registrado = flag.value;
      if (flag.value === 1 && !data.fecha_consentimiento && !isUpdate) {
        data.fecha_consentimiento = todayDate();
      }
    }
  }

  return { ok: errors.length === 0, errors, data };
}

export function validateSeguimientoPayload(body, categories, isUpdate = false) {
  const errors = [];
  const data = {};

  if (!isUpdate || body.persona_id !== undefined) {
    if (body.persona_id === null || body.persona_id === '' || body.persona_id === undefined) {
      data.persona_id = null;
    } else {
      const id = parsePositiveId(body.persona_id);
      if (!id) errors.push('La persona seleccionada no es válida.');
      else data.persona_id = id;
    }
  }

  if (!isUpdate || body.localidad_id !== undefined) {
    if (body.localidad_id === null || body.localidad_id === '' || body.localidad_id === undefined) {
      data.localidad_id = null;
    } else {
      const id = parsePositiveId(body.localidad_id);
      if (!id) errors.push('La localidad seleccionada no es válida.');
      else data.localidad_id = id;
    }
  }

  if (!isUpdate || body.tipo !== undefined) {
    const tipo = readTextField(body, 'tipo', 80, 'Tipo de seguimiento');
    if (!tipo.ok) {
      errors.push(tipo.error);
    } else if (!tipo.value) {
      errors.push('Debes seleccionar un tipo de seguimiento.');
    } else if (categories.tipo_seguimiento && !categories.tipo_seguimiento.has(tipo.value)) {
      errors.push('El tipo de seguimiento seleccionado no es válido.');
    } else {
      data.tipo = tipo.value;
    }
  }

  if (!isUpdate || body.descripcion !== undefined) {
    const desc = readTextField(body, 'descripcion', 2000, 'Descripción');
    if (!desc.ok) errors.push(desc.error);
    else if (!desc.value) errors.push('La descripción del seguimiento es obligatoria.');
    else data.descripcion = desc.value;
  }

  if (!isUpdate || body.fecha !== undefined) {
    const raw = body.fecha === undefined && !isUpdate ? todayDate() : body.fecha;
    const fecha = parseIsoDate(raw, 'fecha de seguimiento');
    if (!fecha.ok) errors.push(fecha.error);
    else if (!fecha.value) errors.push('La fecha del seguimiento es obligatoria.');
    else data.fecha = fecha.value;
  }

  if (!isUpdate || body.estado !== undefined) {
    const estado = readTextField(body, 'estado', 80, 'Estado del seguimiento');
    if (!estado.ok) {
      errors.push(estado.error);
    } else {
      const finalEstado = estado.value || 'pendiente';
      if (categories.estado_seguimiento && !categories.estado_seguimiento.has(finalEstado)) {
        errors.push('El estado del seguimiento seleccionado no es válido.');
      } else {
        data.estado = finalEstado;
      }
    }
  }

  return { ok: errors.length === 0, errors, data };
}

