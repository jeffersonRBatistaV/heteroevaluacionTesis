const express = require('express');
const { q } = require('../db');
const { verificarClave, versionClave } = require('../auth');

const r = express.Router();

function requiereUsuario(req, res, next) {
  if (!req.usuario) return res.redirect('/');
  next();
}

const limpiarNombre = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
// Sin espacios, sin tildes y en mayúsculas: el ingreso no distingue mayúsculas ni tildes
const limpiarMatricula = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toUpperCase().slice(0, 30);
// Compara nombres sin importar mayúsculas, tildes ni espacios extra
const normalizar = (s) => limpiarNombre(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Con `fija` (llegó por el enlace de una sesión) solo se ofrece esa sesión
function pantallaIngreso(res, extra = {}, status = 200) {
  const fija = extra.fija || null;
  const sesiones = fija ? [fija] : q.sesionesAbiertas();
  res.status(status).render('inicio', {
    modo: 'estudiante', error: null, errorAdmin: null, nombre: '', matricula: '',
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

// El estudiante entra solo si su nombre y su matrícula están en la lista que cargó el admin para esa sesión
r.post('/entrar', (req, res) => {
  const nombre = limpiarNombre(req.body.nombre);
  const matricula = limpiarMatricula(req.body.matricula);
  const fija = req.body.codigo ? q.sesionPorCodigo(req.body.codigo) : null;
  const sesionId = fija ? fija.id : Number(req.body.sesion) || null;
  const fallo = (error) => pantallaIngreso(res, { error, nombre, matricula, fija, sesionId: sesionId || '' }, 400);

  const sesion = sesionId ? q.sesion(sesionId) : null;
  if (!sesion) return fallo('Elige tu sesión en la lista.');
  if (!nombre) return fallo('Escribe tu nombre completo.');
  if (!matricula) return fallo('Escribe tu matrícula.');

  const p = q.participanteEnSesion(sesion.id, matricula);
  if (!p || normalizar(p.nombre) !== normalizar(nombre)) {
    return fallo(`No encontramos ese nombre y matrícula en "${sesion.nombre}". Escríbelos tal como te registró tu profesor; si el problema sigue, pídele que revise la lista.`);
  }
  q.marcarIngreso(p.id);
  req.session.participanteId = p.id;
  req.session.admin = false;
  req.session.flash = `Hola, ${p.nombre}. ${sesion.abierta ? 'Evalúa a tus compañeros de sesión.' : 'La sesión está cerrada: puedes consultar tus resultados.'}`;
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

r.get('/participantes', requiereUsuario, (req, res) => {
  res.render('participantes', { lista: q.listaParaEvaluador(req.usuario) });
});

function evaluadoValido(req) {
  const ev = q.participantePorId(Number(req.params.id));
  if (!ev || ev.id === req.usuario.id || ev.sesion_id !== req.usuario.sesion_id) return null;
  return ev;
}

r.get('/evaluar/:id', requiereUsuario, (req, res) => {
  const evaluado = evaluadoValido(req);
  if (!evaluado) {
    req.session.flash = 'Solo puedes evaluar a compañeros de tu sesión, y no a ti mismo.';
    return res.redirect('/participantes');
  }
  const ev = q.evaluacionDe(req.usuario.id, evaluado.id);
  const lista = q.listaParaEvaluador(req.usuario);
  res.render('evaluar', {
    hechas: lista.filter((p) => p.mi_puntaje != null).length,
    totalCompaneros: lista.length,
    evaluado,
    criterios: q.criteriosActivos(req.usuario.rubrica_id),
    selecciones: ev ? q.seleccionesDe(ev.id) : {},
    existente: !!ev,
    cerrada: !req.usuario.abierta,
  });
});

r.post('/evaluar/:id', requiereUsuario, (req, res) => {
  const evaluado = evaluadoValido(req);
  if (!evaluado) return res.redirect('/participantes');
  if (!req.usuario.abierta) {
    req.session.flash = 'La sesión está cerrada; ya no se pueden registrar evaluaciones.';
    return res.redirect('/participantes');
  }
  // Cada criterio llega como c_<id> = opción elegida (1 = Deficiente … 5 = Excelente)
  const selecciones = {};
  for (const [k, v] of Object.entries(req.body)) if (/^c_\d+$/.test(k)) selecciones[k.slice(2)] = Number(v);
  const total = q.guardarEvaluacion(req.usuario.id, evaluado.id, req.usuario.rubrica_id, selecciones);
  if (total == null) {
    req.session.flashError = 'Califica todos los criterios antes de enviar la evaluación.';
    return res.redirect(`/evaluar/${evaluado.id}`);
  }
  // Pasa directo al siguiente compañero que falta evaluar
  const siguiente = q.listaParaEvaluador(req.usuario).find((p) => p.mi_puntaje == null && p.id !== evaluado.id);
  if (siguiente && req.body.seguir !== '0') {
    req.session.flash = `Guardaste la evaluación de ${evaluado.nombre} (${total}/100). Sigue con ${siguiente.nombre}.`;
    return res.redirect(`/evaluar/${siguiente.id}`);
  }
  req.session.flash = siguiente
    ? `Guardaste la evaluación de ${evaluado.nombre} (${total}/100).`
    : `Guardaste la evaluación de ${evaluado.nombre} (${total}/100). Ya evaluaste a todos tus compañeros.`;
  res.redirect('/participantes');
});

// Los estudiantes solo ven su propio resultado; la página general de resultados ya no existe para ellos
r.get('/resultados', (req, res) => res.redirect(req.usuario ? '/mi-resultado' : '/'));

// Cuántos compañeros evaluó el estudiante y cuántos necesita para ver su resultado
function avance(u, porcentaje) {
  const lista = q.listaParaEvaluador(u);
  const total = lista.length;
  const hechas = lista.filter((p) => p.mi_puntaje != null).length;
  const requeridas = Math.ceil((total * porcentaje) / 100 - 1e-9);
  return { total, hechas, requeridas, faltan: Math.max(0, requeridas - hechas), habilitado: hechas >= requeridas };
}

r.get('/mi-resultado', requiereUsuario, (req, res) => {
  const a = avance(req.usuario, res.locals.config.porcentajeParaVer);
  // Sin el mínimo de evaluaciones hechas no se envía ningún dato del resultado
  if (!a.habilitado) return res.render('mi-resultado', { avance: a, resumen: null, desglose: [] });
  res.render('mi-resultado', {
    avance: a,
    resumen: q.resultadoDe(req.usuario.id),
    desglose: q.desgloseDe(req.usuario.id, req.usuario.rubrica_id),
  });
});

module.exports = r;
