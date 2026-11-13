-- Migración 0002: Categorías configurables iniciales y localidades territoriales sugeridas
-- Nota: Estas localidades pueden editarse, desactivarse, eliminarse o ampliarse desde la interfaz.
-- No se incluyen registros ficticios de personas ni datos personales reales.

INSERT OR IGNORE INTO configuracion_categorias (grupo, clave, etiqueta, orden, activa) VALUES
  ('estado_registro', 'confirmado', 'Confirmado', 1, 1),
  ('estado_registro', 'pendiente_actualizacion', 'Pendiente de actualización', 2, 1),
  ('estado_registro', 'por_confirmar', 'Por confirmar', 3, 1),
  ('estado_registro', 'requiere_visita', 'Requiere visita', 4, 1),
  ('estado_registro', 'inactivo', 'Inactivo / Trasladado', 5, 1),

  ('medio_comunicacion', 'lsch', 'Lengua de Señas Chilena (LSCh)', 1, 1),
  ('medio_comunicacion', 'escrito', 'Comunicación escrita', 2, 1),
  ('medio_comunicacion', 'lectura_labial', 'Lectura labial', 3, 1),
  ('medio_comunicacion', 'bimodal', 'Bimodal / Mixto', 4, 1),
  ('medio_comunicacion', 'senas_caseras', 'Señas familiares o naturales', 5, 1),
  ('medio_comunicacion', 'videollamada', 'Videollamada en señas', 6, 1),
  ('medio_comunicacion', 'otro', 'Otro medio', 7, 1),

  ('nivel_lsch', 'basico', 'Básico', 1, 1),
  ('nivel_lsch', 'intermedio', 'Intermedio', 2, 1),
  ('nivel_lsch', 'avanzado', 'Avanzado', 3, 1),
  ('nivel_lsch', 'nativo', 'Fluido / Nativo', 4, 1),
  ('nivel_lsch', 'no_aplica', 'No utiliza LSCh', 5, 1),

  ('tipo_seguimiento', 'visita_realizada', 'Visita realizada', 1, 1),
  ('tipo_seguimiento', 'visita_pendiente', 'Visita pendiente', 2, 1),
  ('tipo_seguimiento', 'confirmar_info', 'Información por confirmar', 3, 1),
  ('tipo_seguimiento', 'info_desactualizada', 'Información desactualizada', 4, 1),
  ('tipo_seguimiento', 'necesidad_interpretacion', 'Necesidad de interpretación', 5, 1),
  ('tipo_seguimiento', 'proxima_accion', 'Próxima acción', 6, 1),

  ('estado_seguimiento', 'pendiente', 'Pendiente', 1, 1),
  ('estado_seguimiento', 'en_curso', 'En curso', 2, 1),
  ('estado_seguimiento', 'completado', 'Completado', 3, 1),
  ('estado_seguimiento', 'cancelado', 'Cancelado', 4, 1);

INSERT OR IGNORE INTO localidades (nombre, region, descripcion, activa, fecha_creacion, fecha_actualizacion) VALUES
  ('Osorno', 'Región de Los Lagos', 'Capital provincial y punto de coordinación territorial amplio.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('Río Negro', 'Región de Los Lagos', 'Localidad y sectores rurales circundantes.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('Purranque', 'Región de Los Lagos', 'Localidad urbana y localidades vecinas del sur provincial.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('Puerto Octay', 'Región de Los Lagos', 'Sector lacustre y áreas rurales cercanas.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('San Pablo', 'Región de Los Lagos', 'Localidad del sector norte provincial.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('Puyehue', 'Región de Los Lagos', 'Entre Lagos y sectores cordilleranos de la comuna.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('San Juan de la Costa', 'Región de Los Lagos', 'Sectores costeros y comunidades rurales.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('Río Bueno', 'Región de Los Ríos', 'Localidad vecina con vinculación territorial.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

