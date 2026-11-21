const path = require('path');
const fs = require('fs');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const express = require('express');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const { q } = require('./db');
const { versionClave } = require('./auth');
const { ESCALA } = require('./escala');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const config = {
  minEvaluaciones: Number(process.env.MIN_EVALUACIONES || 1),
  notaAprobacion: Number(process.env.NOTA_APROBACION || 80),
  // % de compañeros que un estudiante debe evaluar para poder ver su propio resultado
  porcentajeParaVer: Number(process.env.PORCENTAJE_PARA_VER || 95),
};

if (!process.env.SESSION_SECRET) {
  console.warn('⚠ Define SESSION_SECRET en .env (usando un valor inseguro de desarrollo).');
}

const ASSET_VER = Date.now().toString(36);

// 2026-11-17 → 17/11/2026
function fecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function iniciales(nombre) {
  const p = String(nombre || '').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

const ICONOS = {
  check: '<path d="M4 10.5l3.5 3.5L16 5.5"/>',
  x: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
  reloj: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>',
  flecha: '<path d="M12 5l-5 5 5 5"/>',
  buscar: '<circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2L17 17"/>',
  descargar: '<path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/>',
  mas: '<path d="M10 4.5v11M4.5 10h11"/>',
  basura: '<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6"/>',
  alerta: '<path d="M10 3.5l7 12.5H3z"/><path d="M10 8.5v3.2M10 14h.01"/>',
};
function icono(nombre, tam = 16) {
  return `<svg width="${tam}" height="${tam}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(
  cookieSession({
    name: 'hev',
    secret: process.env.SESSION_SECRET || 'dev-secret',
    maxAge: 1000 * 60 * 60 * 24 * 180,
    sameSite: 'lax',
    httpOnly: true,
  })
);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.LIMITE_PETICIONES || 600), // por IP y minuto; un aula comparte IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Las consultas de estado en vivo (cada pocos segundos por estudiante) no cuentan: un aula entera comparte IP
    skip: (req) => req.method === 'GET' && /^\/(estado\.json|admin\/sesion\/\d+\/ronda\.json)$/.test(req.path),
  })
);

// Usuario actual + helpers para las vistas
app.use((req, res, next) => {
  // Si la contraseña del admin cambió, las sesiones de admin anteriores se cierran
  if (req.session.admin && req.session.adminVer !== versionClave()) req.session.admin = false;
  const u = req.session.participanteId ? q.participantePorId(req.session.participanteId) : null;
  if (req.session.participanteId && !u) req.session.participanteId = null;
  req.usuario = u;
  res.locals.usuario = u;
  res.locals.esAdmin = !!req.session.admin;
  // ¿Falta mostrar el tutorial a esta persona? (solo la primera vez que entra)
  res.locals.tutorialPendiente = u ? !u.tutorial_visto : req.session.admin ? q.leerConfig('admin_tutorial_visto') !== '1' : false;
  res.locals.config = config;
  res.locals.ruta = req.path;
  res.locals.estado = (r) => {
    if (!r || r.n_eval < config.minEvaluaciones || r.promedio == null) return 'pendiente';
    return r.promedio >= (r.umbral ?? config.notaAprobacion) ? 'aprobado' : 'reprobado';
  };
  res.locals.escala = ESCALA;
  res.locals.fecha = fecha;
  res.locals.iniciales = iniciales;
  // "1 evaluación" / "3 evaluaciones"
  res.locals.plural = (n, uno, varios) => `${n} ${Number(n) === 1 ? uno : varios}`;
  res.locals.icono = icono;
  res.locals.assetVer = ASSET_VER;
  res.locals.flash = req.session.flash || null;
  res.locals.flashError = req.session.flashError || null;
  req.session.flashError = null;
  req.session.flash = null;
  next();
});

app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('mensaje', { titulo: 'No encontrado', texto: 'La página no existe.' }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('mensaje', { titulo: 'Error', texto: 'Ocurrió un error inesperado.' });
});

app.listen(PORT, '127.0.0.1', () => console.log(`Heteroevaluación en http://localhost:${PORT}`));
