/**
 * Servidor HTTP local en GJS que ejecuta exactamente worker/src/index.js
 * para pruebas de integración y verificación end-to-end en navegador.
 */

import './install_globals.mjs';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { createD1Bridge } from './worker_runtime_shim.mjs';
import worker from '../../worker/src/index.js';

const port = Number(GLib.getenv('WORKER_PORT') || 8787);
const dbRpcUrl = GLib.getenv('DB_RPC_URL') || 'http://127.0.0.1:8789/d1';

const env = {
  DB: createD1Bridge(dbRpcUrl),
  FRONTEND_URL: GLib.getenv('FRONTEND_URL') || 'http://127.0.0.1:8080',
  ALLOWED_ORIGINS: GLib.getenv('ALLOWED_ORIGINS') || 'http://127.0.0.1:8080,http://localhost:8080',
  GITHUB_CLIENT_ID: GLib.getenv('GITHUB_CLIENT_ID') || 'test-client-id',
  GITHUB_CLIENT_SECRET: GLib.getenv('GITHUB_CLIENT_SECRET') || 'test-client-secret',
  ADMIN_GITHUB_ID: GLib.getenv('ADMIN_GITHUB_ID') || '100001',
  SESSION_TTL_HOURS: GLib.getenv('SESSION_TTL_HOURS') || '12',
  COOKIE_SAMESITE: GLib.getenv('COOKIE_SAMESITE') || 'auto',
  COOKIE_DOMAIN: GLib.getenv('COOKIE_DOMAIN') || '',
  SESSION_PEPPER: GLib.getenv('SESSION_PEPPER') || 'test-pepper',
  GITHUB_OAUTH_BASE: GLib.getenv('GITHUB_OAUTH_BASE') || 'http://127.0.0.1:8790',
  GITHUB_API_BASE: GLib.getenv('GITHUB_API_BASE') || 'http://127.0.0.1:8790',
  DISABLE_RATE_LIMIT: GLib.getenv('DISABLE_RATE_LIMIT') || '0',
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const server = new Soup.Server();
server.add_handler('/', (srv, msg, path) => {
  try {
    const uri = msg.get_uri();
    const hostHeader = msg.get_request_headers().get_one('Host') || `127.0.0.1:${port}`;
    const query = uri.get_query();
    const fullUrl = `http://${hostHeader}${path}${query ? `?${query}` : ''}`;

    const reqHeaders = new globalThis.Headers();
    msg.get_request_headers().foreach((name, value) => {
      reqHeaders.append(name, value);
    });

    const reqBodyObj = msg.get_request_body();
    let bodyStr = '';
    if (reqBodyObj && reqBodyObj.length > 0) {
      const flat = reqBodyObj.flatten();
      if (flat) {
        bodyStr = decoder.decode(flat.toArray());
      }
    }

    const request = new globalThis.Request(fullUrl, {
      method: msg.get_method(),
      headers: reqHeaders,
      body: bodyStr,
    });

    msg.pause();

    worker
      .fetch(request, env)
      .then(async (response) => {
        const respText = await response.text();
        msg.set_status(response.status, null);

        const respHeaders = msg.get_response_headers();
        let contentType = 'text/plain; charset=utf-8';
        for (const [k, v] of response.headers.entries()) {
          if (k === 'content-type') {
            contentType = v;
          } else {
            respHeaders.append(k, v);
          }
        }

        if (respText.length > 0 || (response.status !== 204 && response.status !== 302)) {
          const bytes = encoder.encode(respText);
          msg.set_response(contentType, Soup.MemoryUse.COPY, bytes);
        } else {
          respHeaders.replace('Content-Type', contentType);
        }

        msg.unpause();
      })
      .catch((err) => {
        printerr('Worker server async error:', err, err?.stack);
        msg.set_status(500, null);
        msg.set_response('application/json', Soup.MemoryUse.COPY, encoder.encode('{"error":"Harness failure"}'));
        msg.unpause();
      });
  } catch (err) {
    printerr('Worker server sync error:', err, err?.stack);
    msg.set_status(500, null);
    msg.set_response('application/json', Soup.MemoryUse.COPY, encoder.encode('{"error":"Harness sync failure"}'));
  }
});

server.listen_local(port, Soup.ServerListenOptions.IPV4_ONLY);
print(`WORKER_READY port=${port}`);

const loop = new GLib.MainLoop(null, false);
loop.run();
