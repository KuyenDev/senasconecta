/**
 * Capa de acceso a Cloudflare D1 (SQLite) mediante consultas preparadas.
 */

export async function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.all();
  return res.results || [];
}

export async function queryOne(db, sql, params = []) {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.first();
  return res || null;
}

export async function execute(db, sql, params = []) {
  const stmt = db.prepare(sql).bind(...params);
  return await stmt.run();
}

export async function generateUniquePersonCode(db) {
  const row = await queryOne(
    db,
    `SELECT COALESCE(MAX(CAST(SUBSTR(codigo_interno, 4) AS INTEGER)), 0) AS max_num
     FROM personas
     WHERE codigo_interno GLOB 'SC-[0-9]*'`
  );
  let nextNum = Number(row?.max_num || 0) + 1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `SC-${String(nextNum + attempt).padStart(4, '0')}`;
    const existing = await queryOne(db, 'SELECT id FROM personas WHERE codigo_interno = ?', [candidate]);
    if (!existing) {
      return candidate;
    }
  }
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().slice(0, 6);
  return `SC-${suffix}`;
}

export async function getCategorySet(db, grupo) {
  const rows = await queryAll(
    db,
    'SELECT clave, etiqueta FROM configuracion_categorias WHERE grupo = ? AND activa = 1 ORDER BY orden ASC, id ASC',
    [grupo]
  );
  return new Map(rows.map((r) => [r.clave, r.etiqueta]));
}

export async function getActiveCategoriesMap(db) {
  const rows = await queryAll(
    db,
    'SELECT id, grupo, clave, etiqueta, orden, activa FROM configuracion_categorias ORDER BY grupo ASC, orden ASC, id ASC'
  );
  const grouped = Object.create(null);
  for (const row of rows) {
    if (!grouped[row.grupo]) {
      grouped[row.grupo] = [];
    }
    grouped[row.grupo].push(row);
  }
  return grouped;
}

