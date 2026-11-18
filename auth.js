// Contraseña del administrador: se guarda cifrada (scrypt + sal) en la tabla `config`.
// La primera vez se toma de ADMIN_PASSWORD en .env (o "cambia-esta-clave"). Desde ahí se cambia en Configuración.
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

function verificarClave(clave) {
  const guardada = leer('admin_clave');
  if (!guardada) return false;
  const [, salHex, hHex] = guardada.split('$');
  const h = crypto.scryptSync(String(clave || ''), Buffer.from(salHex, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

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

module.exports = { verificarClave, cambiarClave, versionClave };
