// Administrador: entra con correo y contraseña. La contraseña se guarda cifrada (scrypt + sal) en la tabla `config`.
// La primera vez se toman de ADMIN_EMAIL y ADMIN_PASSWORD en .env. Desde ahí se cambian en Configuración.
const crypto = require('crypto');
const { db } = require('./db');

db.exec('CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
const leer = (k) => db.prepare('SELECT valor FROM config WHERE clave = ?').get(k)?.valor ?? null;
const escribir = (k, v) => db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(k, String(v));

function cifrar(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(clave), sal, 64);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}

// Compara una contraseña con un hash "scrypt$sal$hash"
function coincide(clave, guardada) {
  if (!guardada) return false;
  const [, salHex, hHex] = String(guardada).split('$');
  if (!salHex || !hHex) return false;
  const h = crypto.scryptSync(String(clave || ''), Buffer.from(salHex, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

const verificarClave = (clave) => coincide(clave, leer('admin_clave'));

// Correo del administrador: se entra con correo y contraseña. No distingue mayúsculas ni espacios.
const normalizarCorreo = (s) => String(s || '').trim().toLowerCase().slice(0, 120);
const correoAdmin = () => leer('admin_correo') || '';
// La contraseña se compara siempre (aunque el correo no coincida) para no revelar por el tiempo cuál falló
function verificarAdmin(correo, clave) {
  const claveOk = verificarClave(clave);
  return claveOk && normalizarCorreo(correo) === correoAdmin();
}
const cambiarCorreo = (nuevo) => escribir('admin_correo', normalizarCorreo(nuevo));

// Cada cambio de contraseña sube la versión: las sesiones de admin con una versión anterior se cierran.
const versionClave = () => Number(leer('admin_version') || 1);

function cambiarClave(nueva) {
  escribir('admin_clave', cifrar(nueva));
  escribir('admin_version', versionClave() + 1);
}

if (!leer('admin_clave')) {
  escribir('admin_clave', cifrar(process.env.ADMIN_PASSWORD || 'cambia-esta-clave'));
  escribir('admin_version', 1);
}
if (!leer('admin_correo')) {
  escribir('admin_correo', normalizarCorreo(process.env.ADMIN_EMAIL || 'admin@example.com'));
}

module.exports = { verificarClave, verificarAdmin, correoAdmin, cambiarCorreo, normalizarCorreo, cambiarClave, versionClave, cifrar, coincide };
