import axios from 'axios';

/**
 * Central Axios instance.
 * - Uses API_BASE_URL when set (injected from frontend/.env via vite define),
 *   otherwise the dev proxy (same origin /api).
 * - Auth rides on the HttpOnly session cookie: withCredentials covers both the
 *   same-origin dev proxy and a direct cross-origin base URL.
 * - On a 401 response the cached user is cleared and the user is sent to login.
 */

const baseURL =
  (import.meta.env.API_BASE_URL || '').replace(/\/$/, '') || '';
const api = axios.create({ baseURL, withCredentials: true });

// --- frontend API debug logging ----------------------------------------
// Prints every request's resolved URL + result so a wrong baseURL (the usual
// cause of a deploy-only 404) is obvious in the browser console. Gated on dev
// mode or a ?debug=1 query so it stays quiet in normal production use.
const DEBUG_API =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && /[?&]debug=1/.test(window.location.search));
if (DEBUG_API) {
  // eslint-disable-next-line no-console
  console.info('[api] baseURL =', baseURL || '(same-origin /api)');
}
api.interceptors.request.use((config) => {
  if (DEBUG_API) {
    const full = `${config.baseURL || window.location.origin}${config.url}`;
    // eslint-disable-next-line no-console
    console.info(`[api] -> ${String(config.method || 'get').toUpperCase()} ${full}`);
  }
  return config;
});


// ngrok's free tier serves an interstitial "You are about to visit" page to
// browser requests, which would hijack the API calls when the dashboard is
// opened through a tunnel. This header tells the ngrok edge to let requests
// straight through (every other server simply ignores it).
api.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';

api.interceptors.response.use(
  (response) => {
    if (DEBUG_API) {
      const url = `${response.config.baseURL || window.location.origin}${response.config.url}`;
      // eslint-disable-next-line no-console
      console.info(`[api] <- ${response.status} ${url}`);
    }
    return response;
  },
  (error) => {
    if (DEBUG_API) {
      const url = `${error.config?.baseURL || window.location.origin}${error.config?.url || ''}`;
      const status = error.response ? error.response.status : 'NO RESPONSE';
      // eslint-disable-next-line no-console
      console.warn(`[api] <- ${status} ${url}`, error.message);
    }
    if (error.response && error.response.status === 401) {
      // Legacy JWT leftovers are wiped too (cleanup for tabs from before the
      // session-cookie migration).
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('admin');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/** Reads the human readable message out of an axios error. */
export function getErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    'An unexpected error occurred'
  );
}

export default api;