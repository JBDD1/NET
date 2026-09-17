// Vercel serverless proxy — forwards /api/* to the Railway backend.
// RAILWAY_URL and FINOVA_PROXY_SECRET are set as Vercel environment variables,
// keeping the backend URL and shared secret out of version control entirely.

export const config = { api: { bodyParser: false } };

const HOP_BY_HOP = /^(host|connection|keep-alive|proxy-authenticate|proxy-authorization|te|trailers|transfer-encoding|upgrade)$/i;
const SKIP_RESPONSE = /^(content-encoding|transfer-encoding|connection)$/i;

export default async function handler(req, res) {
  const railwayUrl = process.env.RAILWAY_URL;
  if (!railwayUrl) {
    console.error('[Finova/Proxy] RAILWAY_URL env var not set');
    return res.status(503).json({ error: 'Proxy no configurado.' });
  }

  const base = railwayUrl.replace(/\/$/, '');
  const targetUrl = base + req.url;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.test(k)) headers[k] = v;
  }
  // Inject shared secret so Railway can reject requests that bypass this proxy
  const proxySecret = process.env.FINOVA_PROXY_SECRET;
  if (proxySecret) headers['x-finova-proxy'] = proxySecret;

  const fetchOpts = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fetchOpts.body = req;
    fetchOpts.duplex = 'half';
  }

  try {
    const upstream = await fetch(targetUrl, fetchOpts);
    res.status(upstream.status);
    for (const [k, v] of upstream.headers.entries()) {
      if (!SKIP_RESPONSE.test(k)) res.setHeader(k, v);
    }
    const body = await upstream.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (err) {
    console.error('[Finova/Proxy] upstream error:', err.message);
    res.status(502).json({ error: 'Error de conexión con el servidor.' });
  }
}
