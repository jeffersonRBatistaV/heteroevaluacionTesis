// Uso en el servidor: node scripts/cambiar-clave.js "nueva-contraseña"
// Sirve para fijar o recuperar la contraseña del administrador sin entrar a la web.
const path = require('path');
const fs = require('fs');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const { cambiarClave } = require('../auth');

const nueva = process.argv[2];
if (!nueva || nueva.length < 8) {
  console.error('Indica una contraseña de al menos 8 caracteres.');
  process.exit(1);
}
cambiarClave(nueva);
console.log('Contraseña del administrador actualizada. Las sesiones de admin abiertas se cerraron.');
