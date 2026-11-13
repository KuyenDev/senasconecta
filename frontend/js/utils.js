/**
 * Utilidades seguras de DOM (anti-XSS), formato en español y helpers generales.
 */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;

      if (key === 'className') {
        node.className = String(value);
      } else if (key === 'text') {
        node.textContent = String(value);
      } else if (key === 'dataset' && typeof value === 'object') {
        for (const [dKey, dVal] of Object.entries(value)) {
          if (dVal !== undefined && dVal !== null) {
            node.dataset[dKey] = String(dVal);
          }
        }
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(node.style, value);
      } else if (key in node && key !== 'list' && key !== 'type' && key !== 'for') {
        node[key] = value;
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }

  const appendChild = (child) => {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) {
      for (const nested of child) appendChild(nested);
    } else if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  };

  appendChild(children);
  return node;
}

export function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function formatDate(isoOrDate) {
  if (!isoOrDate) return '—';
  const str = String(isoOrDate).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) return str;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return String(isoString);
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(dt);
}

export function triBoolLabel(value, emptyText = 'Sin especificar') {
  if (value === 1 || value === true) return 'Sí';
  if (value === 0 || value === false) return 'No';
  return emptyText;
}

export function fullName(persona) {
  if (!persona) return '—';
  return [persona.nombre, persona.apellido].filter(Boolean).join(' ').trim() || 'Sin nombre';
}

export function getCategoryLabel(categorias, grupo, clave, fallback = 'Sin especificar') {
  if (!clave) return fallback;
  const list = categorias?.[grupo] || [];
  const found = list.find((c) => c.clave === clave);
  return found ? found.etiqueta : clave;
}

export function getStatusBadgeClass(estado) {
  switch (estado) {
    case 'confirmado':
    case 'completado':
      return 'badge-success';
    case 'pendiente_actualizacion':
    case 'pendiente':
    case 'por_confirmar':
      return 'badge-warning';
    case 'requiere_visita':
    case 'en_curso':
      return 'badge-info';
    case 'inactivo':
    case 'cancelado':
      return 'badge-neutral';
    default:
      return 'badge-neutral';
  }
}

export function createBadge(text, className = 'badge-neutral') {
  return el('span', { className: `badge ${className}`, text });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename, className: 'sr-only' });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeHttpUrl(rawUrl) {
  const s = String(rawUrl ?? '').trim();
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  return '';
}

export function hasCoords(item) {
  return (
    item !== null &&
    item !== undefined &&
    typeof item.latitud === 'number' &&
    Number.isFinite(item.latitud) &&
    typeof item.longitud === 'number' &&
    Number.isFinite(item.longitud)
  );
}

export function buildGoogleMapsUrl(persona) {
  if (!persona || typeof persona !== 'object') return '';
  const explicit = safeHttpUrl(persona.mapa_url);
  if (explicit) return explicit;
  if (hasCoords(persona)) {
    return `https://www.google.com/maps/search/?api=1&query=${persona.latitud},${persona.longitud}`;
  }
  const queryParts = [persona.direccion, persona.sector, persona.localidad_nombre].filter(Boolean);
  if (persona.direccion && queryParts.length) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${queryParts.join(', ')}, Chile`)}`;
  }
  return '';
}

