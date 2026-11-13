/**
 * Limitador de frecuencia de solicitudes respaldado por D1 sin almacenar IPs en texto claro.
 */

import { errorResponse, sha256Hex } from '../utils.js';

const BUCKETS = {
  auth: { windowSeconds: 600, maxRequests: 40 },
  import: { windowSeconds: 600, maxRequests: 20 },
  api: { windowSeconds: 60, maxRequests: 300 },
};

export async function enforceRateLimit(request, env, bucketName = 'api') {
  if (env.DISABLE_RATE_LIMIT === '1') {
    return null;
  }

  const config = BUCKETS[bucketName] || BUCKETS.api;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / config.windowSeconds) * config.windowSeconds;

  const rawIp =
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    'local';

  const pepper = String(env.SESSION_PEPPER || 'sc-default-pepper');
  const keyHash = await sha256Hex(`${pepper}|${bucketName}|${windowStart}|${rawIp}`);

  try {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key_hash, bucket, count, window_start)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key_hash) DO UPDATE SET count = count + 1`
    )
      .bind(keyHash, bucketName, windowStart)
      .run();

    const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key_hash = ?')
      .bind(keyHash)
      .first();

    // Limpieza ligera ocasional de ventanas vencidas
    if (Math.random() < 0.05) {
      const cutoff = windowStart - config.windowSeconds * 2;
      await env.DB.prepare('DELETE FROM rate_limits WHERE bucket = ? AND window_start < ?')
        .bind(bucketName, cutoff)
        .run();
    }

    if (row && Number(row.count) > config.maxRequests) {
      const retryAfter = Math.max(1, windowStart + config.windowSeconds - nowSec);
      const res = errorResponse(
        'Has realizado demasiadas solicitudes en poco tiempo. Espera unos segundos e intenta nuevamente.',
        429,
        'RATE_LIMITED'
      );
      res.headers.set('Retry-After', String(retryAfter));
      return res;
    }
  } catch {
    // No bloquear por fallo transitorio de rate_limits, aunque se mantiene la autenticación obligatoria.
  }

  return null;
}

