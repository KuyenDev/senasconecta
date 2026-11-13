/**
 * Adaptador de pruebas local para ejecutar el código real del Cloudflare Worker (ES Modules)
 * sobre GJS (SpiderMonkey) + GLib/Soup + puente SQLite para D1.
 * Uso exclusivo en pruebas locales (no se incluye en despliegue).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const urandomFile = Gio.File.new_for_path('/dev/urandom');

function getSecureRandomBytes(length) {
  const stream = urandomFile.read(null);
  const bytes = stream.read_bytes(length, null);
  stream.close(null);
  return bytes.toArray();
}

export function installWorkerGlobals() {
  if (typeof globalThis.btoa !== 'function') {
    globalThis.btoa = (str) => {
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i += 1) {
        bytes[i] = str.charCodeAt(i) & 0xff;
      }
      return GLib.base64_encode(bytes);
    };
  }

  if (typeof globalThis.atob !== 'function') {
    globalThis.atob = (b64) => {
      const bytes = GLib.base64_decode(b64);
      let out = '';
      for (let i = 0; i < bytes.length; i += 1) {
        out += String.fromCharCode(bytes[i]);
      }
      return out;
    };
  }

  class PolyURLSearchParams {
    constructor(init = '') {
      this._entries = [];
      if (typeof init === 'string') {
        const clean = init.startsWith('?') ? init.slice(1) : init;
        if (clean) {
          for (const part of clean.split('&')) {
            if (!part) continue;
            const idx = part.indexOf('=');
            const k = idx >= 0 ? part.slice(0, idx) : part;
            const v = idx >= 0 ? part.slice(idx + 1) : '';
            this._entries.push([
              decodeURIComponent(k.replace(/\+/g, ' ')),
              decodeURIComponent(v.replace(/\+/g, ' ')),
            ]);
          }
        }
      } else if (init && typeof init === 'object') {
        for (const [k, v] of Object.entries(init)) {
          this._entries.push([String(k), String(v)]);
        }
      }
    }
    get(key) {
      const found = this._entries.find(([k]) => k === key);
      return found ? found[1] : null;
    }
    set(key, value) {
      const k = String(key);
      const v = String(value);
      const idx = this._entries.findIndex(([ek]) => ek === k);
      if (idx >= 0) {
        this._entries[idx] = [k, v];
        this._entries = this._entries.filter(([ek], i) => ek !== k || i === idx);
      } else {
        this._entries.push([k, v]);
      }
    }
    append(key, value) {
      this._entries.push([String(key), String(value)]);
    }
    delete(key) {
      this._entries = this._entries.filter(([k]) => k !== key);
    }
    has(key) {
      return this._entries.some(([k]) => k === key);
    }
    toString() {
      return this._entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    }
    *entries() {
      for (const pair of this._entries) yield pair;
    }
    [Symbol.iterator]() {
      return this.entries();
    }
  }

  class PolyURL {
    constructor(urlStr, base) {
      let full = String(urlStr);
      if (base && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(full)) {
        const b = new PolyURL(base);
        if (full.startsWith('/')) {
          full = `${b.origin}${full}`;
        } else {
          const baseDir = b.pathname.endsWith('/')
            ? b.pathname
            : b.pathname.slice(0, b.pathname.lastIndexOf('/') + 1) || '/';
          const pathOnly = full.split('?')[0].split('#')[0];
          const segments = baseDir.split('/').filter(Boolean);
          for (const seg of pathOnly.split('/')) {
            if (!seg || seg === '.') continue;
            if (seg === '..') segments.pop();
            else segments.push(seg);
          }
          const qIdx = full.indexOf('?');
          const hIdx = full.indexOf('#');
          const suffixIdx = qIdx >= 0 && hIdx >= 0 ? Math.min(qIdx, hIdx) : Math.max(qIdx, hIdx);
          const suffix = suffixIdx >= 0 ? full.slice(suffixIdx) : '';
          full = `${b.origin}/${segments.join('/')}${suffix}`;
        }
      }
      const match = /^(https?):\/\/([^/:?#]+)(?::(\d+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(full);
      if (!match) {
        throw new TypeError(`Invalid URL: ${urlStr}`);
      }
      this.protocol = `${match[1].toLowerCase()}:`;
      this.hostname = match[2];
      this.port = match[3] || '';
      this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname;
      this.origin = `${this.protocol}//${this.host}`;
      this.pathname = match[4] || '/';
      this.searchParams = new PolyURLSearchParams(match[5] || '');
      this.hash = match[6] || '';
    }
    get search() {
      const qs = this.searchParams.toString();
      return qs ? `?${qs}` : '';
    }
    get href() {
      return `${this.origin}${this.pathname}${this.search}${this.hash}`;
    }
    toString() {
      return this.href;
    }
  }

  globalThis.URLSearchParams = PolyURLSearchParams;
  globalThis.URL = PolyURL;

  class PolyHeaders {
    constructor(init = null) {
      this._map = new Map();
      this._setCookies = [];
      if (init instanceof PolyHeaders) {
        for (const [k, v] of init.entries()) {
          this.append(k, v);
        }
      } else if (Array.isArray(init)) {
        for (const [k, v] of init) this.append(k, v);
      } else if (init && typeof init === 'object') {
        for (const [k, v] of Object.entries(init)) {
          this.append(k, v);
        }
      }
    }
    set(name, value) {
      const lower = String(name).toLowerCase();
      if (lower === 'set-cookie') {
        this._setCookies = [String(value)];
      } else {
        this._map.set(lower, String(value));
      }
    }
    append(name, value) {
      const lower = String(name).toLowerCase();
      if (lower === 'set-cookie') {
        this._setCookies.push(String(value));
      } else if (this._map.has(lower)) {
        this._map.set(lower, `${this._map.get(lower)}, ${String(value)}`);
      } else {
        this._map.set(lower, String(value));
      }
    }
    get(name) {
      const lower = String(name).toLowerCase();
      if (lower === 'set-cookie') {
        return this._setCookies.length ? this._setCookies.join(', ') : null;
      }
      return this._map.has(lower) ? this._map.get(lower) : null;
    }
    getSetCookie() {
      return [...this._setCookies];
    }
    has(name) {
      const lower = String(name).toLowerCase();
      if (lower === 'set-cookie') return this._setCookies.length > 0;
      return this._map.has(lower);
    }
    delete(name) {
      const lower = String(name).toLowerCase();
      if (lower === 'set-cookie') this._setCookies = [];
      else this._map.delete(lower);
    }
    *entries() {
      for (const [k, v] of this._map.entries()) yield [k, v];
      for (const c of this._setCookies) yield ['set-cookie', c];
    }
    [Symbol.iterator]() {
      return this.entries();
    }
  }

  globalThis.Headers = PolyHeaders;

  class PolyRequest {
    constructor(url, init = {}) {
      this.url = String(url);
      this.method = (init.method || 'GET').toUpperCase();
      this.headers = new PolyHeaders(init.headers || {});
      this._body = init.body !== undefined && init.body !== null ? String(init.body) : '';
    }
    async text() {
      return this._body;
    }
    async json() {
      return JSON.parse(this._body);
    }
  }

  class PolyResponse {
    constructor(body = null, init = {}) {
      this.status = init.status || 200;
      this.statusText = init.statusText || '';
      this.headers = new PolyHeaders(init.headers || {});
      this.body = body;
      this._bodyText = body === null || body === undefined ? '' : String(body);
    }
    get ok() {
      return this.status >= 200 && this.status < 300;
    }
    async text() {
      return this._bodyText;
    }
    async json() {
      return JSON.parse(this._bodyText);
    }
  }

  globalThis.Request = PolyRequest;
  globalThis.Response = PolyResponse;

  globalThis.crypto = {
    getRandomValues(arr) {
      const bytes = getSecureRandomBytes(arr.byteLength);
      const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      view.set(bytes);
      return arr;
    },
    randomUUID() {
      const b = getSecureRandomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    subtle: {
      async digest(algorithm, data) {
        const algo = typeof algorithm === 'string' ? algorithm : algorithm?.name;
        if (String(algo).toUpperCase() !== 'SHA-256') {
          throw new Error(`Unsupported digest algorithm: ${algo}`);
        }
        const chk = new GLib.Checksum(GLib.ChecksumType.SHA256);
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        chk.update(bytes);
        const hex = chk.get_string();
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i += 1) {
          out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return out.buffer;
      },
    },
  };

  const soupSession = new Soup.Session();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const rawUrl = String(url);
    const resolvedUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)
      ? rawUrl
      : new PolyURL(rawUrl, globalThis.location?.href || globalThis.window?.location?.href).href;
    const msg = Soup.Message.new(method, resolvedUrl);
    const reqHeaders = new PolyHeaders(init.headers || {});
    let contentType = 'application/json';
    for (const [k, v] of reqHeaders.entries()) {
      if (k === 'content-type') contentType = v;
      else msg.get_request_headers().append(k, v);
    }
    if (init.body !== undefined && init.body !== null) {
      const bodyBytes = GLib.Bytes.new(encoder.encode(String(init.body)));
      msg.set_request_body_from_bytes(contentType, bodyBytes);
    }
    const respBytes = await new Promise((resolve, reject) => {
      soupSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (_sess, res) => {
        try {
          resolve(soupSession.send_and_read_finish(res));
        } catch (err) {
          reject(err);
        }
      });
    });
    const text = decoder.decode(respBytes.toArray());
    const respHeaders = new PolyHeaders();
    msg.get_response_headers().foreach((name, value) => {
      respHeaders.append(name, value);
    });
    return new PolyResponse(text, {
      status: msg.get_status(),
      headers: respHeaders,
    });
  };
}

