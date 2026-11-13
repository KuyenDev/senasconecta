import './harness/install_globals.mjs';
import { getCookiePolicy } from '../worker/src/middleware/auth.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// 1. Cross-site HTTPS (github.io + workers.dev)
const pCross = getCookiePolicy(
  new Request('https://senasconecta-api.ejemplo.workers.dev/auth/callback'),
  { FRONTEND_URL: 'https://usuario.github.io/senasconecta', COOKIE_SAMESITE: 'auto' }
);
assert(pCross.sameSite === 'None', 'Cross-site must use SameSite=None');
assert(pCross.secure === true, 'Cross-site must be Secure');
assert(pCross.name === 'sc_session', 'Cross-site uses sc_session');
assert(pCross.mode === 'cross-site-none', 'Mode cross-site-none');

// 2. Same-site custom domain with COOKIE_DOMAIN
const pDomain = getCookiePolicy(
  new Request('https://api.senasconecta.cl/auth/callback'),
  {
    FRONTEND_URL: 'https://app.senasconecta.cl',
    COOKIE_SAMESITE: 'auto',
    COOKIE_DOMAIN: '.senasconecta.cl',
  }
);
assert(pDomain.sameSite === 'Lax', 'Shared domain must use SameSite=Lax');
assert(pDomain.secure === true, 'Shared domain must be Secure');
assert(pDomain.domain === '.senasconecta.cl', 'Domain preserved');
assert(pDomain.mode === 'same-site-domain', 'Mode same-site-domain');

// 3. Same-origin HTTPS without COOKIE_DOMAIN
const pSame = getCookiePolicy(
  new Request('https://senasconecta.cl/api/auth/callback'),
  { FRONTEND_URL: 'https://senasconecta.cl', COOKIE_SAMESITE: 'auto' }
);
assert(pSame.sameSite === 'Lax', 'Same origin must use SameSite=Lax');
assert(pSame.name === '__Host-sc_session', 'Same origin uses __Host- prefix');
assert(pSame.mode === 'same-origin-lax', 'Mode same-origin-lax');

print('COOKIE_POLICY_TESTS_OK');

