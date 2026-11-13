/**
 * Encabezados de seguridad defensiva para todas las respuestas del Worker.
 */

export function applySecurityHeaders(response, requestUrl) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');

  if (requestUrl.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const contentType = headers.get('Content-Type') || '';
  if (contentType.includes('application/json') || requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/auth/')) {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    headers.set('Pragma', 'no-cache');
  }

  if (!headers.has('Content-Security-Policy') && !contentType.includes('text/html')) {
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

