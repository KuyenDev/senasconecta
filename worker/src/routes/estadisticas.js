/**
 * Rutas de estadísticas territoriales y de comunicación para SeñasConecta.
 * Incluye conteo explícito de datos faltantes para evitar porcentajes engañosos.
 */

import { queryAll, queryOne } from '../database.js';
import { jsonResponse } from '../utils.js';

function buildRatioMetric(yesCount, noCount, unknownCount) {
  const si = Number(yesCount || 0);
  const no = Number(noCount || 0);
  const sin_dato = Number(unknownCount || 0);
  const con_dato = si + no;
  const total = con_dato + sin_dato;
  return {
    si,
    no,
    sin_dato,
    con_dato,
    total,
    porcentaje_si_informado: con_dato > 0 ? Math.round((si / con_dato) * 1000) / 10 : null,
    porcentaje_no_informado: con_dato > 0 ? Math.round((no / con_dato) * 1000) / 10 : null,
    cobertura_datos_pct: total > 0 ? Math.round((con_dato / total) * 1000) / 10 : null,
  };
}

export async function handleEstadisticasRoutes(request, env, requestUrl) {
  if (request.method !== 'GET' || requestUrl.pathname !== '/api/estadisticas') {
    return null;
  }

  const [
    summaryRow,
    porLocalidad,
    porCongregacion,
    porEstado,
    porMedio,
    porNivelLsch,
    seguimientosPorTipo,
    seguimientosPorEstado,
  ] = await Promise.all([
    queryOne(
      env.DB,
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN estado = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
        SUM(CASE WHEN estado = 'pendiente_actualizacion' THEN 1 ELSE 0 END) AS pendientes_actualizacion,
        SUM(CASE WHEN estado = 'por_confirmar' THEN 1 ELSE 0 END) AS por_confirmar,
        SUM(CASE WHEN estado = 'requiere_visita' THEN 1 ELSE 0 END) AS requieren_visita,
        SUM(CASE WHEN estado = 'inactivo' THEN 1 ELSE 0 END) AS inactivos,
        SUM(CASE WHEN usa_lsch = 1 THEN 1 ELSE 0 END) AS usa_lsch_si,
        SUM(CASE WHEN usa_lsch = 0 THEN 1 ELSE 0 END) AS usa_lsch_no,
        SUM(CASE WHEN usa_lsch IS NULL THEN 1 ELSE 0 END) AS usa_lsch_sin_dato,
        SUM(CASE WHEN prefiere_escrita = 1 THEN 1 ELSE 0 END) AS escrita_si,
        SUM(CASE WHEN prefiere_escrita = 0 THEN 1 ELSE 0 END) AS escrita_no,
        SUM(CASE WHEN prefiere_escrita IS NULL THEN 1 ELSE 0 END) AS escrita_sin_dato,
        SUM(CASE WHEN necesita_interpretacion = 1 THEN 1 ELSE 0 END) AS interp_si,
        SUM(CASE WHEN necesita_interpretacion = 0 THEN 1 ELSE 0 END) AS interp_no,
        SUM(CASE WHEN necesita_interpretacion IS NULL THEN 1 ELSE 0 END) AS interp_sin_dato,
        SUM(CASE WHEN localidad_id IS NULL THEN 1 ELSE 0 END) AS sin_localidad,
        SUM(CASE WHEN congregacion_id IS NULL THEN 1 ELSE 0 END) AS sin_congregacion
       FROM personas`
    ),
    queryAll(
      env.DB,
      `SELECT
        l.id,
        l.nombre,
        l.activa,
        COUNT(p.id) AS total,
        SUM(CASE WHEN p.estado = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
        SUM(CASE WHEN p.estado IN ('pendiente_actualizacion', 'por_confirmar', 'requiere_visita') THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN p.usa_lsch = 1 THEN 1 ELSE 0 END) AS usan_lsch,
        SUM(CASE WHEN p.necesita_interpretacion = 1 THEN 1 ELSE 0 END) AS necesitan_interpretacion
       FROM localidades l
       LEFT JOIN personas p ON p.localidad_id = l.id
       GROUP BY l.id, l.nombre, l.activa
       ORDER BY total DESC, l.nombre COLLATE NOCASE ASC`
    ),
    queryAll(
      env.DB,
      `SELECT
        c.id,
        c.nombre,
        c.activa,
        COUNT(p.id) AS total,
        SUM(CASE WHEN p.estado = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
        SUM(CASE WHEN p.estado IN ('pendiente_actualizacion', 'por_confirmar', 'requiere_visita') THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN p.necesita_interpretacion = 1 THEN 1 ELSE 0 END) AS necesitan_interpretacion
       FROM congregaciones c
       LEFT JOIN personas p ON p.congregacion_id = c.id
       GROUP BY c.id, c.nombre, c.activa
       ORDER BY total DESC, c.nombre COLLATE NOCASE ASC`
    ),
    queryAll(
      env.DB,
      `SELECT estado AS clave, COUNT(*) AS total
       FROM personas
       GROUP BY estado
       ORDER BY total DESC`
    ),
    queryAll(
      env.DB,
      `SELECT COALESCE(NULLIF(TRIM(medio_comunicacion), ''), 'sin_especificar') AS clave, COUNT(*) AS total
       FROM personas
       GROUP BY COALESCE(NULLIF(TRIM(medio_comunicacion), ''), 'sin_especificar')
       ORDER BY total DESC`
    ),
    queryAll(
      env.DB,
      `SELECT COALESCE(NULLIF(TRIM(nivel_lsch), ''), 'sin_especificar') AS clave, COUNT(*) AS total
       FROM personas
       WHERE usa_lsch = 1 OR (nivel_lsch IS NOT NULL AND TRIM(nivel_lsch) != '')
       GROUP BY COALESCE(NULLIF(TRIM(nivel_lsch), ''), 'sin_especificar')
       ORDER BY total DESC`
    ),
    queryAll(
      env.DB,
      `SELECT tipo AS clave, COUNT(*) AS total
       FROM seguimientos
       GROUP BY tipo
       ORDER BY total DESC`
    ),
    queryAll(
      env.DB,
      `SELECT estado AS clave, COUNT(*) AS total
       FROM seguimientos
       GROUP BY estado
       ORDER BY total DESC`
    ),
  ]);

  const totalPersonas = Number(summaryRow?.total || 0);
  const sinLocalidad = Number(summaryRow?.sin_localidad || 0);
  const sinCongregacion = Number(summaryRow?.sin_congregacion || 0);

  const localidadesFull = [...porLocalidad];
  if (sinLocalidad > 0) {
    const rowUnassigned = await queryOne(
      env.DB,
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN estado = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
        SUM(CASE WHEN estado IN ('pendiente_actualizacion', 'por_confirmar', 'requiere_visita') THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN usa_lsch = 1 THEN 1 ELSE 0 END) AS usan_lsch,
        SUM(CASE WHEN necesita_interpretacion = 1 THEN 1 ELSE 0 END) AS necesitan_interpretacion
       FROM personas WHERE localidad_id IS NULL`
    );
    localidadesFull.push({
      id: null,
      nombre: 'Sin localidad asignada',
      activa: 1,
      total: Number(rowUnassigned?.total || 0),
      confirmados: Number(rowUnassigned?.confirmados || 0),
      pendientes: Number(rowUnassigned?.pendientes || 0),
      usan_lsch: Number(rowUnassigned?.usan_lsch || 0),
      necesitan_interpretacion: Number(rowUnassigned?.necesitan_interpretacion || 0),
    });
  }

  const congregacionesFull = [...porCongregacion];
  if (sinCongregacion > 0) {
    const rowUnassigned = await queryOne(
      env.DB,
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN estado = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
        SUM(CASE WHEN estado IN ('pendiente_actualizacion', 'por_confirmar', 'requiere_visita') THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN necesita_interpretacion = 1 THEN 1 ELSE 0 END) AS necesitan_interpretacion
       FROM personas WHERE congregacion_id IS NULL`
    );
    congregacionesFull.push({
      id: null,
      nombre: 'Sin congregación asignada',
      activa: 1,
      total: Number(rowUnassigned?.total || 0),
      confirmados: Number(rowUnassigned?.confirmados || 0),
      pendientes: Number(rowUnassigned?.pendientes || 0),
      necesitan_interpretacion: Number(rowUnassigned?.necesitan_interpretacion || 0),
    });
  }

  return jsonResponse({
    total_personas: totalPersonas,
    estados_registro: {
      confirmados: Number(summaryRow?.confirmados || 0),
      pendientes_actualizacion: Number(summaryRow?.pendientes_actualizacion || 0),
      por_confirmar: Number(summaryRow?.por_confirmar || 0),
      requieren_visita: Number(summaryRow?.requieren_visita || 0),
      inactivos: Number(summaryRow?.inactivos || 0),
      desglose: porEstado,
    },
    comunicacion: {
      usa_lsch: buildRatioMetric(summaryRow?.usa_lsch_si, summaryRow?.usa_lsch_no, summaryRow?.usa_lsch_sin_dato),
      prefiere_escrita: buildRatioMetric(summaryRow?.escrita_si, summaryRow?.escrita_no, summaryRow?.escrita_sin_dato),
      necesita_interpretacion: buildRatioMetric(summaryRow?.interp_si, summaryRow?.interp_no, summaryRow?.interp_sin_dato),
      medios: porMedio,
      niveles_lsch: porNivelLsch,
    },
    por_localidad: localidadesFull,
    por_congregacion: congregacionesFull,
    seguimientos: {
      por_tipo: seguimientosPorTipo,
      por_estado: seguimientosPorEstado,
    },
  });
}

