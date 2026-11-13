/**
 * Rutas de resumen principal (Dashboard) para SeñasConecta.
 */

import { queryAll, queryOne } from '../database.js';
import { jsonResponse } from '../utils.js';

export async function handleDashboardRoutes(request, env, requestUrl) {
  if (request.method !== 'GET' || requestUrl.pathname !== '/api/dashboard') {
    return null;
  }

  const [
    personasCounts,
    locCounts,
    congCounts,
    segPendingRow,
    porLocalidad,
    porCongregacion,
    porEstado,
    ultimosAgregados,
    ultimasPersonasMod,
    ultimosSegMod,
    proximosSeguimientos,
  ] = await Promise.all([
    queryOne(
      env.DB,
      `SELECT
        COUNT(*) AS total_personas,
        SUM(CASE WHEN estado = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
        SUM(CASE WHEN estado = 'pendiente_actualizacion' THEN 1 ELSE 0 END) AS pendientes_actualizacion,
        SUM(CASE WHEN estado = 'por_confirmar' THEN 1 ELSE 0 END) AS por_confirmar,
        SUM(CASE WHEN estado = 'requiere_visita' THEN 1 ELSE 0 END) AS requieren_visita,
        SUM(CASE WHEN necesita_interpretacion = 1 THEN 1 ELSE 0 END) AS necesitan_interpretacion,
        SUM(CASE WHEN usa_lsch = 1 THEN 1 ELSE 0 END) AS usan_lsch,
        SUM(CASE WHEN prefiere_escrita = 1 THEN 1 ELSE 0 END) AS prefieren_escrita
       FROM personas`
    ),
    queryOne(
      env.DB,
      `SELECT
        COUNT(*) AS total_localidades,
        SUM(CASE WHEN activa = 1 THEN 1 ELSE 0 END) AS localidades_activas
       FROM localidades`
    ),
    queryOne(
      env.DB,
      `SELECT
        COUNT(*) AS total_congregaciones,
        SUM(CASE WHEN activa = 1 THEN 1 ELSE 0 END) AS congregaciones_activas
       FROM congregaciones`
    ),
    queryOne(
      env.DB,
      `SELECT COUNT(*) AS seguimientos_pendientes
       FROM seguimientos
       WHERE estado IN ('pendiente', 'en_curso')`
    ),
    queryAll(
      env.DB,
      `SELECT
        l.id AS localidad_id,
        l.nombre AS localidad_nombre,
        l.activa AS localidad_activa,
        COUNT(p.id) AS total
       FROM localidades l
       LEFT JOIN personas p ON p.localidad_id = l.id
       GROUP BY l.id, l.nombre, l.activa
       ORDER BY total DESC, l.nombre ASC`
    ),
    queryAll(
      env.DB,
      `SELECT
        c.id AS congregacion_id,
        c.nombre AS congregacion_nombre,
        c.activa AS congregacion_activa,
        COUNT(p.id) AS total
       FROM congregaciones c
       LEFT JOIN personas p ON p.congregacion_id = c.id
       GROUP BY c.id, c.nombre, c.activa
       ORDER BY total DESC, c.nombre ASC`
    ),
    queryAll(
      env.DB,
      `SELECT estado, COUNT(*) AS total
       FROM personas
       GROUP BY estado
       ORDER BY total DESC, estado ASC`
    ),
    queryAll(
      env.DB,
      `SELECT
        p.id, p.codigo_interno, p.nombre, p.apellido, p.sector, p.estado, p.fecha_creacion,
        l.nombre AS localidad_nombre,
        c.nombre AS congregacion_nombre
       FROM personas p
       LEFT JOIN localidades l ON l.id = p.localidad_id
       LEFT JOIN congregaciones c ON c.id = p.congregacion_id
       ORDER BY p.fecha_creacion DESC, p.id DESC
       LIMIT 5`
    ),
    queryAll(
      env.DB,
      `SELECT
        p.id, p.codigo_interno, p.nombre, p.apellido, p.estado, p.fecha_creacion, p.fecha_actualizacion,
        l.nombre AS localidad_nombre
       FROM personas p
       LEFT JOIN localidades l ON l.id = p.localidad_id
       ORDER BY p.fecha_actualizacion DESC, p.id DESC
       LIMIT 5`
    ),
    queryAll(
      env.DB,
      `SELECT
        s.id, s.tipo, s.estado, s.fecha, s.descripcion, s.fecha_actualizacion,
        p.id AS persona_id, p.nombre AS persona_nombre, p.apellido AS persona_apellido,
        l.nombre AS localidad_nombre
       FROM seguimientos s
       LEFT JOIN personas p ON p.id = s.persona_id
       LEFT JOIN localidades l ON l.id = s.localidad_id
       ORDER BY s.fecha_actualizacion DESC, s.id DESC
       LIMIT 5`
    ),
    queryAll(
      env.DB,
      `SELECT
        s.id, s.tipo, s.estado, s.fecha, s.descripcion,
        p.id AS persona_id, p.nombre AS persona_nombre, p.apellido AS persona_apellido, p.codigo_interno,
        COALESCE(l_seg.nombre, l_per.nombre) AS localidad_nombre
       FROM seguimientos s
       LEFT JOIN personas p ON p.id = s.persona_id
       LEFT JOIN localidades l_seg ON l_seg.id = s.localidad_id
       LEFT JOIN localidades l_per ON l_per.id = p.localidad_id
       WHERE s.estado IN ('pendiente', 'en_curso')
       ORDER BY s.fecha ASC, s.id ASC
       LIMIT 6`
    ),
  ]);

  const sinLocalidadRow = await queryOne(
    env.DB,
    'SELECT COUNT(*) AS total FROM personas WHERE localidad_id IS NULL'
  );
  const sinCongRow = await queryOne(
    env.DB,
    'SELECT COUNT(*) AS total FROM personas WHERE congregacion_id IS NULL'
  );

  const distLocalidades = [...porLocalidad];
  if (Number(sinLocalidadRow?.total || 0) > 0) {
    distLocalidades.push({
      localidad_id: null,
      localidad_nombre: 'Sin localidad asignada',
      localidad_activa: 1,
      total: Number(sinLocalidadRow.total),
    });
  }

  const distCongregaciones = [...porCongregacion];
  if (Number(sinCongRow?.total || 0) > 0) {
    distCongregaciones.push({
      congregacion_id: null,
      congregacion_nombre: 'Sin congregación asignada',
      congregacion_activa: 1,
      total: Number(sinCongRow.total),
    });
  }

  return jsonResponse({
    resumen: {
      total_personas: Number(personasCounts?.total_personas || 0),
      total_localidades: Number(locCounts?.total_localidades || 0),
      localidades_activas: Number(locCounts?.localidades_activas || 0),
      total_congregaciones: Number(congCounts?.total_congregaciones || 0),
      congregaciones_activas: Number(congCounts?.congregaciones_activas || 0),
      confirmados: Number(personasCounts?.confirmados || 0),
      pendientes_actualizacion: Number(personasCounts?.pendientes_actualizacion || 0),
      por_confirmar: Number(personasCounts?.por_confirmar || 0),
      requieren_visita: Number(personasCounts?.requieren_visita || 0),
      seguimientos_pendientes: Number(segPendingRow?.seguimientos_pendientes || 0),
      necesitan_interpretacion: Number(personasCounts?.necesitan_interpretacion || 0),
      usan_lsch: Number(personasCounts?.usan_lsch || 0),
      prefieren_escrita: Number(personasCounts?.prefieren_escrita || 0),
    },
    distribucion_localidades: distLocalidades,
    distribucion_congregaciones: distCongregaciones,
    distribucion_estados: porEstado,
    ultimos_agregados: ultimosAgregados,
    ultimas_modificaciones: ultimasPersonasMod,
    ultimos_seguimientos_modificados: ultimosSegMod,
    proximos_seguimientos: proximosSeguimientos,
  });
}

