const express = require('express');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');
const { verificarClave, versionClave, cifrar, coincide } = require('../auth');

const r = express.Router();

// Solo entra quien ya se registró (tiene contraseña)
function requiereUsuario(req, res, next) {
  if (!req.usuario || !req.usuario.clave) {
    req.session.participanteId = null;
    return res.redirect('/');
  }
  next();
}

// Sin espacios, sin tildes y en mayúsculas: el ingreso no distingue mayúsculas ni tildes
const limpiarMatricula = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toUpperCase().slice(0, 30);
const limpiarNombre = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
// Compara nombres sin importar mayúsculas, tildes ni espacios extra
const normalizar = (s) => limpiarNombre(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// modo: 'estudiante' (entrar), 'registro' (primera vez) o 'admin'. `fija`: llegó con el enlace de una sesión.
function pantallaIngreso(res, extra = {}, status = 200) {
  res.status(status).render('inicio', {
    modo: 'estudiante', error: null, errorRegistro: null, errorAdmin: null,
    matricula: '', nombre: '', fija: null,
    ...extra,
  });
}

r.get('/', (req, res) => {
  if (req.usuario && req.usuario.clave) return res.redirect('/participantes');
  if (req.session.admin) return res.redirect('/admin');
  const modo = ['admin', 'registro'].includes(req.query.modo) ? req.query.modo : 'estudiante';
  pantallaIngreso(res, { modo });
});

// Enlace para compartir una sesión: /s/CODIGO
r.get('/s/:codigo', (req, res) => {
  const fija = q.sesionPorCodigo(req.params.codigo);
  if (!fija) {
    return res.status(404).render('mensaje', { titulo: 'Enlace no válido', texto: 'Este enlace de sesión no existe o fue reemplazado. Pide el enlace actual a tu profesor.' });
  }
  if (req.usuario && req.usuario.clave) return res.redirect('/participantes');
  pantallaIngreso(res, { fija, modo: req.query.modo === 'registro' ? 'registro' : 'estudiante' });
});

// Intentos fallidos por matrícula, no por IP: un aula entera comparte IP
const limitePorMatricula = (modo, texto) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${modo}|${limpiarMatricula(req.body.matricula)}`,
  handler: (req, res) => pantallaIngreso(res, {
    modo, [modo === 'registro' ? 'errorRegistro' : 'error']: texto,
    matricula: limpiarMatricula(req.body.matricula), nombre: limpiarNombre(req.body.nombre),
    fija: req.body.codigo ? q.sesionPorCodigo(req.body.codigo) : null,
  }, 429),
});

// De las inscripciones de un estudiante, la sesión con la que entra: la del enlace si vino por él; si no, la abierta más reciente
function elegirInscripcion(inscripciones, fija) {
  return (fija && inscripciones.find((p) => p.sesion_id === fija.id)) || inscripciones[0];
}
function iniciarSesion(req, res, p, saludo) {
  q.marcarIngreso(p.id);
  req.session.participanteId = p.id;
  req.session.admin = false;
  req.session.flash = `${saludo} ${p.abierta ? 'Evalúa a quien expone en cada ronda.' : 'La sesión está cerrada: puedes consultar tus resultados.'}`;
  res.redirect('/participantes');
}

// Entrar: solo con matrícula y la contraseña que el estudiante creó al registrarse
r.post('/entrar', limitePorMatricula('estudiante', 'Demasiados intentos fallidos con esta matrícula. Espera 15 minutos y vuelve a intentarlo.'), (req, res) => {
  const matricula = limpiarMatricula(req.body.matricula);
  const clave = String(req.body.clave || '');
  const fija = req.body.codigo ? q.sesionPorCodigo(req.body.codigo) : null;
  const fallo = (error, status = 400) => pantallaIngreso(res, { error, matricula, fija }, status);
  if (!matricula) return fallo('Escribe tu matrícula.');
  if (!clave) return fallo('Escribe tu contraseña.');

  const todas = q.inscripcionesDe(matricula);
  const registradas = todas.filter((p) => p.clave);
  if (todas.length && !registradas.length) {
    return fallo('Esta matrícula aún no se ha registrado. Pulsa "Registrarme" para crear tu contraseña.', 401);
  }
  const validas = registradas.filter((p) => coincide(clave, p.clave));
  if (!validas.length) {
    return fallo('La matrícula o la contraseña no son correctas. Si olvidaste tu contraseña, pide a tu profesor que la restablezca.', 401);
  }
  const p = elegirInscripcion(validas, fija);
  iniciarSesion(req, res, p, `Hola, ${p.nombre}.`);
});

// Registro (primera vez): matrícula y nombre deben coincidir con la lista del profesor; la contraseña se escribe dos veces
r.post('/registro', limitePorMatricula('registro', 'Demasiados intentos con esta matrícula. Espera 15 minutos y vuelve a intentarlo.'), (req, res) => {
  const matricula = limpiarMatricula(req.body.matricula);
  const nombre = limpiarNombre(req.body.nombre);
  const { clave, repetir } = req.body;
  const fija = req.body.codigo ? q.sesionPorCodigo(req.body.codigo) : null;
  const fallo = (errorRegistro, status = 400) => pantallaIngreso(res, { modo: 'registro', errorRegistro, matricula, nombre, fija }, status);
  if (!matricula) return fallo('Escribe tu matrícula.');
  if (!nombre) return fallo('Escribe tu nombre completo.');

  const todas = q.inscripcionesDe(matricula);
  if (!todas.length) return fallo('Esta matrícula no está en ninguna lista. Pide a tu profesor que te agregue y vuelve a intentarlo.');
  const coinciden = todas.filter((p) => normalizar(p.nombre) === normalizar(nombre));
  if (!coinciden.length) return fallo('El nombre no coincide con el de la lista de tu profesor. Escríbelo completo, tal como te registró.');
  const pendientes = coinciden.filter((p) => !p.clave);
  if (!pendientes.length) return fallo('Esta matrícula ya está registrada. Entra con tu matrícula y tu contraseña.');

  if (String(clave || '').length < 6) return fallo('La contraseña debe tener al menos 6 caracteres.');
  if (limpiarMatricula(clave) === matricula) return fallo('La contraseña no puede ser tu matrícula.');
  if (clave !== repetir) return fallo('Las dos contraseñas no coinciden. Escríbela igual en ambos campos.');

  // La misma contraseña sirve para todas las sesiones en que aparece con esa matrícula y ese nombre
  const hash = cifrar(clave);
  pendientes.forEach((p) => q.guardarClaveParticipante(p.id, hash));
  const p = elegirInscripcion(pendientes.map((x) => ({ ...x, clave: hash })), fija);
  iniciarSesion(req, res, p, `Listo, ${p.nombre}: ya estás registrado. Desde ahora entras con tu matrícula y tu contraseña.`);
});

// Cambiar la contraseña (ya registrado): pide la actual
r.get('/crear-clave', (req, res) => {
  if (!req.usuario || !req.usuario.clave) return res.redirect('/');
  res.render('crear-clave', { error: null });
});

r.post('/crear-clave', (req, res) => {
  const u = req.usuario;
  if (!u || !u.clave) return res.redirect('/');
  const { actual, nueva, repetir } = req.body;
  const fallo = (error) => res.status(400).render('crear-clave', { error });
  if (!coincide(actual, u.clave)) return fallo('La contraseña actual no es correcta.');
  if (String(nueva || '').length < 6) return fallo('La contraseña debe tener al menos 6 caracteres.');
  if (limpiarMatricula(nueva) === u.matricula.toUpperCase()) return fallo('La contraseña no puede ser tu matrícula.');
  if (nueva !== repetir) return fallo('Las dos contraseñas no coinciden.');
  q.cambiarClaveMatricula(u.matricula, u.clave, cifrar(nueva));
  req.session.flash = 'Contraseña actualizada.';
  res.redirect('/participantes');
});

// Ingreso del administrador desde la misma pantalla
r.post('/entrar-admin', (req, res) => {
  if (verificarClave(req.body.clave)) {
    req.session.admin = true;
    req.session.adminVer = versionClave();
    req.session.participanteId = null;
    return res.redirect('/admin');
  }
  pantallaIngreso(res, { modo: 'admin', errorAdmin: 'La contraseña no es correcta. Revisa mayúsculas y vuelve a intentarlo.' }, 401);
});

// Marca el tutorial como visto (estudiante o profesor) para no volver a abrirlo solo
r.post('/tutorial/visto', (req, res) => {
  if (req.usuario) q.marcarTutorialVisto(req.usuario.id);
  else if (req.session.admin) q.escribirConfig('admin_tutorial_visto', '1');
  res.status(204).end();
});

r.post('/salir', (req, res) => {
  req.session.participanteId = null;
  req.session.admin = false;
  res.redirect('/');
});

// La evaluación es siempre por turnos: el profesor abre la ronda de quien expone y solo se califica ese trabajo.
// Firma del estado que ve el estudiante: si cambia (se abre o cierra una ronda, o la sesión), su pantalla se recarga
const firma = (u) => `${u.abierta ? 1 : 0}|${u.expositor_id || ''}`;

// Estado en vivo para la actualización automática de la pantalla del estudiante
r.get('/estado.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.usuario) return res.status(401).json({ error: 'sin sesión' });
  const u = req.usuario;
  res.json({ firma: firma(u), abierta: !!u.abierta, expositor: u.expositor_id || null });
});

r.get('/instructivo', (req, res) => res.render('instructivo'));

r.get('/participantes', requiereUsuario, (req, res) => {
  const lista = q.listaParaEvaluador(req.usuario);
  const u = req.usuario;
  const expositor = u.expositor_id ? (u.expositor_id === u.id ? { id: u.id, nombre: u.nombre, yo: true } : lista.find((p) => p.id === u.expositor_id) || null) : null;
  res.render('participantes', { lista, expositor, firma: firma(u) });
});

function evaluadoValido(req) {
  const ev = q.participantePorId(Number(req.params.id));
  if (!ev || ev.id === req.usuario.id || ev.sesion_id !== req.usuario.sesion_id) return null;
  return ev;
}

// Solo se puede calificar (o corregir) al expositor de la ronda abierta
const rondaAbiertaPara = (u, evaluado) => u.expositor_id === evaluado.id;
const limpiarComentario = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);

r.get('/evaluar/:id', requiereUsuario, (req, res) => {
  const evaluado = evaluadoValido(req);
  if (!evaluado) {
    req.session.flash = 'Solo puedes evaluar a compañeros de tu sesión, y no a ti mismo.';
    return res.redirect('/participantes');
  }
  const ev = q.evaluacionDe(req.usuario.id, evaluado.id);
  const enRonda = rondaAbiertaPara(req.usuario, evaluado);
  // Sin ronda abierta y sin evaluación previa no hay nada que mostrar
  if (!enRonda && !ev) {
    req.session.flashError = evaluado.expuso_en
      ? `La ronda de ${evaluado.nombre} ya se cerró y no enviaste tu evaluación.`
      : `${evaluado.nombre} aún no expone. Podrás evaluar su trabajo cuando tu profesor abra su ronda.`;
    return res.redirect('/participantes');
  }
  res.render('evaluar', {
    evaluado,
    criterios: q.criteriosActivos(req.usuario.rubrica_id),
    selecciones: ev ? q.seleccionesDe(ev.id) : {},
    comentario: ev ? ev.comentario : '',
    existente: !!ev,
    cerrada: !req.usuario.abierta,
    rondaCerrada: req.usuario.abierta && !enRonda,
    firma: firma(req.usuario),
  });
});

r.post('/evaluar/:id', requiereUsuario, (req, res) => {
  const evaluado = evaluadoValido(req);
  if (!evaluado) return res.redirect('/participantes');
  if (!req.usuario.abierta) {
    req.session.flash = 'La sesión está cerrada; ya no se pueden registrar evaluaciones.';
    return res.redirect('/participantes');
  }
  if (!rondaAbiertaPara(req.usuario, evaluado)) {
    req.session.flashError = `La ronda de ${evaluado.nombre} se cerró antes de que enviaras la evaluación. No se guardó.`;
    return res.redirect('/participantes');
  }
  // Cada criterio llega como c_<id> = opción elegida (1 = No aceptable … 5 = Excelente; nivel 0 a 4)
  const selecciones = {};
  for (const [k, v] of Object.entries(req.body)) if (/^c_\d+$/.test(k)) selecciones[k.slice(2)] = Number(v);
  const total = q.guardarEvaluacion(req.usuario.id, evaluado.id, req.usuario.rubrica_id, selecciones, limpiarComentario(req.body.comentario));
  if (total == null) {
    req.session.flashError = 'Califica todos los criterios antes de enviar la evaluación.';
    return res.redirect(`/evaluar/${evaluado.id}`);
  }
  req.session.flash = `Guardaste la evaluación de ${evaluado.nombre} (${total}/100). Espera a que tu profesor abra la siguiente ronda.`;
  res.redirect('/participantes');
});

// Los estudiantes solo ven su propio resultado; la página general de resultados ya no existe para ellos
r.get('/resultados', (req, res) => res.redirect(req.usuario ? '/mi-resultado' : '/'));

// Cuántos compañeros evaluó el estudiante y cuántos necesita para ver su resultado.
// Solo cuentan los compañeros que ya expusieron.
function avance(u, porcentaje) {
  const lista = q.listaParaEvaluador(u).filter((p) => p.expuso_en);
  const total = lista.length;
  const hechas = lista.filter((p) => p.mi_puntaje != null).length;
  const requeridas = Math.ceil((total * porcentaje) / 100 - 1e-9);
  return { total, hechas, requeridas, faltan: Math.max(0, requeridas - hechas), habilitado: hechas >= requeridas };
}

r.get('/mi-resultado', requiereUsuario, (req, res) => {
  const a = avance(req.usuario, res.locals.config.porcentajeParaVer);
  // Sin el mínimo de evaluaciones hechas no se envía ningún dato del resultado
  if (!a.habilitado) return res.render('mi-resultado', { avance: a, resumen: null, desglose: [], comentarios: [] });
  res.render('mi-resultado', {
    avance: a,
    resumen: q.resultadoDe(req.usuario.id),
    desglose: q.desgloseDe(req.usuario.id, req.usuario.rubrica_id),
    comentarios: q.comentariosDe(req.usuario.id),
  });
});

module.exports = r;
