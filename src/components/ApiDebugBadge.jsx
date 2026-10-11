import { useMemo } from 'react';

/**
 * ApiDebugBadge — a small on-screen indicator that shows the API base URL the
 * browser is ACTUALLY calling. Appears only in dev or with ?debug=1 in the URL,
 * so normal visitors never see it.
 *
 * Why this exists: a deploy-only 404 is almost always an empty API_BASE_URL in
 * the build, which makes the app call its own origin (vercel.app/api/...) with
 * no backend behind it. Seeing "same-origin" on a non-localhost host is the
 * smoking gun — it means API_BASE_URL wasn't set (or wasn't rebuilt) on Vercel.
 */
const DEBUG =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' && /[?&]debug=1/.test(window.location.search));

export default function ApiDebugBadge() {
  const { base, host, origin, misconfigured } = useMemo(() => {
    const raw = (import.meta.env.API_BASE_URL || '').replace(/\/$/, '');
    const hostname = typeof window !== 'undefined' ? window.location.host : '';
    const sameOrigin = !raw;
    const local = /(^localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(hostname);
    return {
      base: raw,
      host: hostname,
      origin: typeof window !== 'undefined' ? window.location.origin : '',
      // Empty base on a real (non-local) host => API calls hit this site and 404.
      misconfigured: sameOrigin && !local,
    };
  }, []);

  if (!DEBUG) return null;

  return (
    <div className={`api-debug-badge ${misconfigured ? 'bad' : 'ok'}`} role="status">
      <div>
        <strong>API base:</strong> {base || `(same-origin → ${origin})`}
      </div>
      <div className="api-debug-host">Site host: {host}</div>
      {misconfigured ? (
        <div className="api-debug-warn">
          ⚠️ <strong>API_BASE_URL is not set in this build.</strong> The login request
          is going to this site, not your backend — that’s the 404. Fix: Vercel →
          Settings → Environment Variables → add{' '}
          <code>API_BASE_URL=https://pollingofficer.onrender.com</code>, then{' '}
          <strong>Redeploy</strong> (it’s baked in at build time).
        </div>
      ) : null}
    </div>
  );
}
