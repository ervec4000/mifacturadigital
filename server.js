const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const BCV_TLS_STRICT = String(process.env.BCV_TLS_STRICT || 'false').toLowerCase() === 'true';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Cabeceras de seguridad HTTP compatibles con iframe y cámara QR local
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});

// Rate limiter en memoria para endpoints /api/* (máx. 100 peticiones/min por IP)
const apiRateStore = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQ = 100;

app.use('/api', (req, res, next) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  const now = Date.now();
  const rec = apiRateStore.get(ip);
  if (!rec || (now - rec.start) > RATE_WINDOW_MS) {
    apiRateStore.set(ip, { start: now, count: 1 });
    return next();
  }
  rec.count += 1;
  if (rec.count > RATE_MAX_REQ) {
    return res.status(429).json({ ok: false, error: 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.' });
  }
  return next();
});

let bcvCache = {
  timestamp: 0,
  data: null
};
const BCV_CACHE_TTL_MS = 5 * 60 * 1000;

function fetchHttpsText(url, { rejectUnauthorized = true, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        rejectUnauthorized,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MiFacturaDigital/1.0)',
          'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'
        }
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          res.resume();
          fetchHttpsText(nextUrl, { rejectUnauthorized, timeoutMs }).then(resolve, reject);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout consultando origen BCV')));
  });
}

async function obtenerTasaBcvOficial() {
  // 1. Fuente primaria: sitio oficial https://www.bcv.org.ve/
  try {
    const res = await fetchHttpsText('https://www.bcv.org.ve/', { rejectUnauthorized: BCV_TLS_STRICT, timeoutMs: 8000 });
    if (res.status >= 200 && res.status < 300 && res.body) {
      const bloqueDolar = res.body.match(/id=["']dolar["'][\s\S]{0,700}?<strong[^>]*>\s*([0-9.,]+)\s*<\/strong>/i);
      if (bloqueDolar && bloqueDolar[1]) {
        const numStr = bloqueDolar[1].trim().replace(/\./g, '').replace(',', '.');
        const usd = parseFloat(numStr);
        if (Number.isFinite(usd) && usd > 0) {
          const matchFecha = res.body.match(/date-display-single[^>]*>([^<]+)</i);
          const fechaValor = matchFecha ? matchFecha[1].trim() : new Date().toISOString().slice(0, 10);
          return {
            ok: true,
            usd: Number(usd.toFixed(4)),
            fechaValor,
            fuente: 'BCV Oficial (www.bcv.org.ve)'
          };
        }
      }
    }
  } catch (err) {
    console.warn('Fallo consulta directa bcv.org.ve, usando respaldo:', err.message);
  }

  // 2. Respaldo automático: ve.dolarapi.com (TLS estricto)
  try {
    const resApi = await fetchHttpsText('https://ve.dolarapi.com/v1/dolares/oficial', { rejectUnauthorized: true, timeoutMs: 6000 });
    if (resApi.status >= 200 && resApi.status < 300 && resApi.body) {
      const json = JSON.parse(resApi.body);
      const usd = parseFloat(json?.promedio || json?.venta || json?.compra);
      if (Number.isFinite(usd) && usd > 0) {
        return {
          ok: true,
          usd: Number(usd.toFixed(4)),
          fechaValor: json.fechaActualizacion ? String(json.fechaActualizacion).slice(0, 10) : new Date().toISOString().slice(0, 10),
          fuente: 'Respaldo Oficial (DolarAPI BCV)'
        };
      }
    }
  } catch (err) {
    console.warn('Fallo respaldo DolarAPI:', err.message);
  }

  return { ok: false, error: 'No se pudo obtener la tasa BCV en este momento.' };
}

app.get('/api/salud', (req, res) => {
  res.json({
    ok: true,
    service: 'MiFacturaDigital.com.ve',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/tasa-bcv', async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const now = Date.now();

  if (!force && bcvCache.data && (now - bcvCache.timestamp) < BCV_CACHE_TTL_MS) {
    return res.json({ ...bcvCache.data, cache: true });
  }

  const resultado = await obtenerTasaBcvOficial();
  if (resultado.ok) {
    bcvCache = { timestamp: now, data: resultado };
    return res.json({ ...resultado, cache: false });
  }

  if (bcvCache.data) {
    return res.json({ ...bcvCache.data, cache: true, stale: true });
  }

  return res.status(502).json(resultado);
});

app.get('/api/saas/pasarela-estado', (req, res) => {
  const proveedores = {
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    lemonSqueezy: Boolean(process.env.LEMONSQUEEZY_API_KEY),
    mercadoPago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN)
  };
  const algunProveedorActivo = Object.values(proveedores).some(Boolean);
  res.json({
    ok: true,
    algunProveedorActivo,
    proveedores,
    transferenciaBancariaActiva: true,
    pagoMovilActivo: true
  });
});

app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js|sql|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Error HTTP:', err?.message || err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
