export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

const PUBLIC_PATHS = ['/auth/login', '/auth/forgot-password', '/auth/set-password'];

/**
 * Chama a API. Use `body` para JSON ou `form` (FormData) para envio com fotos.
 * No navegador a sessão vai no cookie httpOnly: o JavaScript nunca toca no token.
 */
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && !PUBLIC_PATHS.some((p) => path.startsWith(p))) onUnauthorized();
    const detail = data.details?.[0];
    const msg = detail?.message && data.error === 'Dados inválidos' ? detail.message : data.error;
    throw new ApiError(msg || 'Algo deu errado', res.status, data.details);
  }
  return data;
}

export const fileUrl = (name) => (name ? `/api/files/${encodeURIComponent(name)}` : null);

/** Lista de categorias para selects (máx. 100, o limite por requisição). */
let categoriesCache;
export async function allCategories(refresh = false) {
  if (!categoriesCache || refresh) categoriesCache = (await api('/categories?pageSize=100')).items;
  return categoriesCache;
}
export function invalidateCategories() {
  categoriesCache = undefined;
}
