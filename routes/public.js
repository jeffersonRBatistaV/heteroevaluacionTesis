const express = require('express');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');
const { verificarClave, versionClave, cifrar, coincide } = require('../auth');

const r = express.Router();

// Además de tener sesión, el estudiante debe haber creado su contraseña
function requiereUsuario(req, res, next) {
  if (!req.usuario) return res.redirect('/');
  if (!req.usuario.clave) return res.redirect('/crear-clave');
  next();
}

// Sin espacios, sin tildes y en mayúsculas: el ingreso no distingue mayúsculas ni tildes
const limpiarMatricula = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toUpperCase().slice(0, 30);

// Con `fija` (llegó por el enlace de una sesión) solo se ofrece esa sesión
function pantallaIngreso(res, extra = {}, status = 200) {
  const fija = extra.fija || null;
  const sesiones = fija ? [fija] : q.sesionesAbiertas();
  res.status(status).render('inicio', {
    modo: 'estudiante', error: null, errorAdmin: null, matricula: '',
    sesionId: fija ? fija.id : '',
    fija, sesiones,
    ...extra,
  });
}

r.get('/', (req, res) => {
  if (req.usuario) return res.redirect('/participantes');
  if (req.session.admin) return res.redirect('/admin');
  pantallaIngreso(res, { modo: req.query.modo === 'admin' ? 'admin' : 'estudiante' });
});

// Enlace para compartir una sesión: /s/CODIGO
r.get('/s/:codigo', (req, res) => {
  const fija = q.sesionPorCodigo(req.params.codigo);
  if (!fija) {
    return res.status(404).render('mensaje', { titulo: 'Enlace no válido', texto: 'Este enlace de sesión no existe o fue reemplazado. Pide el enlace actual a tu profesor.' });
  }
  if (req.usuario) return res.redirect('/participantes');
  pantallaIngreso(res, { fija });
});

// Intentos fallidos por cuenta (sesión + matrícula), no por IP: un aula entera comparte IP
const limiteIngreso = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.body.codigo || req.body.sesion || ''}|${limpiarMatricula(req.body.matricula)}`,
  handler: (req, res) => pantallaIngreso(res, {
    error: 'Demasiados intentos fallidos con esta matrícula. Espera 15 minutos o pide a tu profesor que restablezca tu contraseña.',
    matricula: limpiarMatricula(req.body.matricula), sesionId: Number(req.body.sesion) || '',
    fija: req.body.codigo ? q.sesionPorCodigo(req.body.codigo) : null,
  }, 429),
});

// Usuario: la matrícula que cargó el profesor en esa sesión. Contraseña: la propia, o la matrícula si aún no la creó.
r.post('/entrar', limiteIngreso, (req, res) => {
  const matricula = limpiarMatricula(req.body.matricula);
  const clave = String(req.body.clave || '');
  const fija = req.body.codigo ? q.sesionPorCodigo(req.body.codigo) : null;
  const sesionId = fija ? fija.id : Number(req.body.sesion) || null;
  const fallo = (error, status = 400) => pantallaIngreso(res, { error, matricula, fija, sesionId: sesionId || '' }, status);

  const sesion = sesionId ? q.sesion(sesionId) : null;
  if (!sesion) return fallo('Elige tu sesión en la lista.');
  if (!matricula) return fallo('Escribe tu matrícula.');
  if (!clave) return fallo('Escribe tu contraseña. Si es tu primera vez, es tu matrícula.');

  const p = q.participanteEnSesion(sesion.id, matricula);
  const valida = p && (p.clave ? coincide(clave, p.clave) : limpiarMatricula(clave) === p.matricula.toUpperCase());
  if (!valida) {
    return fallo(`La matrícula o la contraseña no son correctas para "${sesion.nombre}". Si es tu primera vez, tu contraseña es tu matrícula. Si olvidaste la tuya, pide a tu profesor que la restablezca.`, 401);
  }
  q.marcarIngreso(p.id);
  req.session.participanteId = p.id;
  req.session.admin = false;
  if (!p.clave) return res.redirect('/crear-clave');
  req.session.flash = `Hola, ${p.nombre}. ${sesion.abierta ? 'Evalúa a tus compañeros de sesión.' : 'La sesión está cerrada: puedes consultar tus resultados.'}`;
  res.redirect('/participantes');
});

// Primera vez (o tras un restablecimiento): el estudiante crea su contraseña antes de seguir
r.get('/crear-clave', (req, res) => {
  if (!req.usuario) return res.redirect('/');
  res.render('crear-clave', { error: null, primera: !req.usuario.clave });
});

r.post('/crear-clave', (req, res) => {
  const u = req.usuario;
  if (!u) return res.redirect('/');
  const { actual, nueva, repetir } = req.body;
  const fallo = (error) => res.status(400).render('crear-clave', { error, primera: !u.clave });
  if (u.clave && !coincide(actual, u.clave)) return fallo('La contraseña actual no es correcta.');
  if (String(nueva || '').length < 6) return fallo('La contraseña debe tener al menos 6 caracteres.');
  if (limpiarMatricula(nueva) === u.matricula.toUpperCase()) return fallo('La contraseña no puede ser tu matrícula.');
  if (nueva !== repetir) return fallo('Las dos contraseñas no coinciden.');
  q.guardarClaveParticipante(u.id, cifrar(nueva));
  req.session.flash = u.clave ? 'Contraseña actualizada.' : `Listo, ${u.nombre}. Desde ahora entras con tu matrícula y esta contraseña.`;
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

// La evaluación es siempre por turnos: el profesor abre la ronda de quien expone y solo a él se le califica.
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
      ? `La ronda de ${evaluado.nombre} ya se cerró y no lo evaluaste.`
      : `${evaluado.nombre} aún no expone. Podrás evaluarlo cuando tu profesor abra su ronda.`;
    return res.redirect('/participantes');
  }
  const lista = q.listaParaEvaluador(req.usuario);
  res.render('evaluar', {
    hechas: lista.filter((p) => p.mi_puntaje != null).length,
    totalCompaneros: lista.length,
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
