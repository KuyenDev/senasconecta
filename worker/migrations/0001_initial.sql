-- Migración 0001: Esquema inicial normalizado para SeñasConecta (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS localidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  region TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  latitud REAL NULL CHECK (latitud IS NULL OR (latitud >= -90 AND latitud <= 90)),
  longitud REAL NULL CHECK (longitud IS NULL OR (longitud >= -180 AND longitud <= 180)),
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS congregaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  localidad_id INTEGER NULL REFERENCES localidades(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS congregacion_localidades (
  congregacion_id INTEGER NOT NULL REFERENCES congregaciones(id) ON DELETE CASCADE,
  localidad_id INTEGER NOT NULL REFERENCES localidades(id) ON DELETE CASCADE,
  PRIMARY KEY (congregacion_id, localidad_id)
);

CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_interno TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  apellido TEXT NOT NULL DEFAULT '',
  localidad_id INTEGER NULL REFERENCES localidades(id) ON DELETE SET NULL,
  sector TEXT NOT NULL DEFAULT '',
  congregacion_id INTEGER NULL REFERENCES congregaciones(id) ON DELETE SET NULL,
  fecha_incorporacion TEXT NULL,
  medio_comunicacion TEXT NOT NULL DEFAULT '',
  usa_lsch INTEGER NULL CHECK (usa_lsch IS NULL OR usa_lsch IN (0, 1)),
  nivel_lsch TEXT NOT NULL DEFAULT '',
  prefiere_escrita INTEGER NULL CHECK (prefiere_escrita IS NULL OR prefiere_escrita IN (0, 1)),
  necesita_interpretacion INTEGER NULL CHECK (necesita_interpretacion IS NULL OR necesita_interpretacion IN (0, 1)),
  observaciones_comunicacion TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'por_confirmar',
  fecha_ultima_visita TEXT NULL,
  proxima_accion TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '',
  consentimiento_registrado INTEGER NOT NULL DEFAULT 0 CHECK (consentimiento_registrado IN (0, 1)),
  fecha_consentimiento TEXT NULL,
  nota_consentimiento TEXT NOT NULL DEFAULT '',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seguimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NULL REFERENCES personas(id) ON DELETE CASCADE,
  localidad_id INTEGER NULL REFERENCES localidades(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  descripcion TEXT NOT NULL CHECK (length(trim(descripcion)) > 0),
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  fecha_creacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracion_categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo TEXT NOT NULL,
  clave TEXT NOT NULL,
  etiqueta TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  UNIQUE (grupo, clave)
);

-- Tablas de autenticación y seguridad separadas de los datos administrativos
CREATE TABLE IF NOT EXISTS sesiones (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  github_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  expiracion TEXT NOT NULL,
  fecha_creacion TEXT NOT NULL,
  ultimo_acceso TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  bind_hash TEXT NOT NULL,
  expiracion TEXT NOT NULL,
  fecha_creacion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Índices para consultas territoriales, búsqueda, filtros y limpieza de sesiones
CREATE INDEX IF NOT EXISTS idx_personas_nombre ON personas(nombre, apellido);
CREATE INDEX IF NOT EXISTS idx_personas_localidad ON personas(localidad_id);
CREATE INDEX IF NOT EXISTS idx_personas_congregacion ON personas(congregacion_id);
CREATE INDEX IF NOT EXISTS idx_personas_estado ON personas(estado);
CREATE INDEX IF NOT EXISTS idx_personas_actualizacion ON personas(fecha_actualizacion DESC);
CREATE INDEX IF NOT EXISTS idx_personas_creacion ON personas(fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_congregaciones_localidad ON congregaciones(localidad_id);
CREATE INDEX IF NOT EXISTS idx_cong_loc_localidad ON congregacion_localidades(localidad_id);

CREATE INDEX IF NOT EXISTS idx_seguimientos_persona ON seguimientos(persona_id);
CREATE INDEX IF NOT EXISTS idx_seguimientos_localidad ON seguimientos(localidad_id);
CREATE INDEX IF NOT EXISTS idx_seguimientos_estado_fecha ON seguimientos(estado, fecha);
CREATE INDEX IF NOT EXISTS idx_seguimientos_actualizacion ON seguimientos(fecha_actualizacion DESC);

CREATE INDEX IF NOT EXISTS idx_sesiones_expiracion ON sesiones(expiracion);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiracion ON oauth_states(expiracion);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(bucket, window_start);

