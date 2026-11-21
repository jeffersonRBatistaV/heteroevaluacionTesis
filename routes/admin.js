const express = require('express');
const { db, q } = require('../db');
const { generarExcel } = require('../excel');
const { verificarClave, cambiarClave, versionClave } = require('../auth');
const multer = require('multer');
const { ESCALA, redondear } = require('../escala');
const { leerLista, plantilla, limpiarNombre, limpiarMatricula, matriculaValida } = require('../importar');

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

const r = express.Router();

function requiereAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/?modo=admin');
  next();
}

const cfg = () => ({
  nota: Number(process.env.NOTA_APROBACION || 80),
  min: Number(process.env.MIN_EVALUACIONES || 1),
});
function estadoDe(f) {
  const { nota, min } = cfg();
  if (f.n_eval < min || f.promedio == null) return 'pendiente';
  return f.promedio > (f.umbral ?? nota) ? 'aprobado' : 'reprobado';
}

// Segunda validación en el servidor: el texto escrito en la ventana debe coincidir
const normTxt = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function confirmado(req, esperado) {
  if (normTxt(req.body.confirmacion) === normTxt(esperado)) return true;
  req.session.flashError = `No se eliminó nada: para confirmar hay que escribir exactamente "${esperado}".`;
  return false;
}
// Umbral de aprobación: número entre 1 y 100 (acepta coma decimal)
function leerUmbral(v) {
  const n = Math.round(Number(String(v ?? '').replace(',', '.')) * 100) / 100;
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const texto = (s, n = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const origen = (req) => `${req.protocol}://${req.get('host')}`;
const hoy = () => new Date().toISOString().slice(0, 10);

// Lee ?sesion= ; `porDefecto` elige la sesión más reciente si no se indicó ninguna
function leerFiltro(req, porDefecto) {
  const sesiones = q.sesiones();
  let sesionId = Number(req.query.sesion) || null;
  if (!sesionId && porDefecto && req.query.sesion === undefined && sesiones.length) sesionId = sesiones[0].id;
  const sesion = sesionId ? q.sesion(sesionId) : null;
  if (!sesion) sesionId = null;
  return { sesionId, sesion, sesiones, qs: sesionId ? `?sesion=${sesionId}` : '?sesion=0' };
}

function base(seccion, filtro) {
  const c = q.conteos();
  return {
    seccion, filtro: filtro || null,
    cuentas: { sesiones: q.sesiones().length, participantes: c.participantes, evaluaciones: c.evaluaciones },
    rubricaGeneralId: q.rubricaGeneralId(),
  };
}

r.get('/login', (req, res) => res.redirect(req.session.admin ? '/admin' : '/?modo=admin'));

// ---------- Dashboard ----------
r.get('/', requiereAdmin, (req, res) => {
  const f = leerFiltro(req, true);
  const { nota } = cfg();
  const conteos = q.conteos(f);
  const resultados = q.resultados(f).map((x) => ({ ...x, estado: estadoDe(x) }));
  const conNota = resultados.filter((x) => x.promedio != null);
  const media = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x.promedio, 0) / xs.length) * 10) / 10 : null);
  const cuenta = (e) => resultados.filter((x) => x.estado === e).length;
  const estados = { aprobado: cuenta('aprobado'), reprobado: cuenta('reprobado'), pendiente: cuenta('pendiente') };
  const definidos = estados.aprobado + estados.reprobado;

  const tramos = Array.from({ length: 10 }, (_, i) => ({ etiqueta: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`, n: 0, nombres: [] }));
  conNota.forEach((x) => {
    const i = Math.min(9, Math.floor(x.promedio / 10));
    tramos[i].n++;
    tramos[i].nombres.push(x.nombre);
  });

  const criterios = f.sesion
    ? q.cumplimientoCriterios(f.sesion.rubrica_id, f).map((c) => ({ nombre: c.nombre, puntos: c.puntos, promedio: c.promedio, n: c.n, conteo: c.conteo, pct: c.pct }))
    : null;

  // Con "Todas las sesiones": comparación de promedios entre sesiones (por fecha)
  const porSesion = !f.sesion
    ? [...f.sesiones].reverse().map((s) => {
        const rs = resultados.filter((x) => x.sesion_id === s.id);
        const cn = rs.filter((x) => x.promedio != null);
        return { nombre: s.nombre, fecha: s.fecha, n: media(cn) ?? 0, participantes: rs.length, conNota: cn.length, umbral: s.umbral };
      })
    : null;

  res.render('admin/dashboard', {
    ...base('dashboard', f),
    conteos, promedioGeneral: media(conNota), estados, definidos, nota: f.sesion ? f.sesion.umbral : null,
    sinEvaluar: resultados.filter((x) => x.n_eval === 0).length,
    tasaAprobacion: definidos ? Math.round((estados.aprobado / definidos) * 100) : null,
    mejores: conNota.slice(0, 5),
    necesitan: [...resultados].sort((a, b) => a.n_eval - b.n_eval || a.nombre.localeCompare(b.nombre)).slice(0, 5),
    datos: { tramos, criterios, porDia: q.evaluacionesPorDia(f), porSesion, umbral: f.sesion ? f.sesion.umbral : null },
  });
});

// ---------- Sesiones ----------
r.get('/sesiones', requiereAdmin, (req, res) => {
  res.render('admin/sesiones', { ...base('sesiones'), sesiones: q.sesiones(), hoy: hoy(), error: null, origen: origen(req) });
});

r.post('/sesiones', requiereAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  const fecha = req.body.fecha;
  if (!nombre || !esFecha(fecha)) {
    return res.status(400).render('admin/sesiones', { ...base('sesiones'), sesiones: q.sesiones(), hoy: fecha || hoy(), error: 'La sesión necesita un nombre y una fecha.', origen: origen(req) });
  }
  const rg = q.rubricaGeneralId();
  const rubricaId = req.body.rubrica === 'propia' ? q.copiarRubrica(rg, `Rúbrica de ${nombre}`) : rg;
  const id = q.crearSesion(nombre, fecha, rubricaId, leerUmbral(req.body.umbral) ?? 80);
  req.session.flash = `Sesión "${nombre}" creada. Comparte su enlace con los estudiantes.`;
  res.redirect(`/admin/sesion/${id}`);
});

function vistaSesion(req, res, s, extra = {}, status = 200) {
  const importe = req.session.importe || null;
  req.session.importe = null;
  res.status(status).render('admin/sesion', {
    ...base('sesiones'), s, importe,
    lista: q.resultados({ sesionId: s.id, orden: 'nombre' }).map((x) => ({ ...x, estado: estadoDe(x) })),
    criterios: q.criteriosActivos(s.rubrica_id), suma: q.sumaActivos(s.rubrica_id),
    ronda: q.estadoRonda(s.id),
    error: null, origen: origen(req),
    ...extra,
  });
}

r.get('/sesion/:id', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (!s) return res.redirect('/admin/sesiones');
  vistaSesion(req, res, s);
});

r.post('/sesion/:id', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (!s) return res.redirect('/admin/sesiones');
  const nombre = texto(req.body.nombre);
  if (!nombre || !esFecha(req.body.fecha)) return vistaSesion(req, res, s, { error: 'La sesión necesita un nombre y una fecha válidos.' }, 400);
  q.actualizarSesion(s.id, nombre, req.body.fecha, req.body.abierta === '1');
  if (req.body.abierta !== '1') q.cerrarRonda(s.id);
  req.session.flash = 'Sesión actualizada.';
  res.redirect(`/admin/sesion/${s.id}`);
});

r.post('/sesion/:id/estado', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (s) {
    q.actualizarSesion(s.id, s.nombre, s.fecha, !s.abierta);
    if (s.abierta) q.cerrarRonda(s.id);
    req.session.flash = s.abierta ? `"${s.nombre}" cerrada: ya no acepta registros ni evaluaciones.` : `"${s.nombre}" abierta.`;
  }
  res.redirect(req.body.volver === 'lista' ? '/admin/sesiones' : `/admin/sesion/${req.params.id}`);
});

r.post('/sesion/:id/borrar', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (!s) return res.redirect('/admin/sesiones');
  if (!confirmado(req, s.nombre)) return res.redirect(req.body.volver === 'lista' ? '/admin/sesiones' : `/admin/sesion/${s.id}`);
  q.borrarSesion(s.id);
  req.session.flash = `Sesión "${s.nombre}" eliminada con sus participantes y evaluaciones.`;
  res.redirect('/admin/sesiones');
});

r.post('/sesion/:id/enlace', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (s) {
    q.regenerarCodigo(s.id);
    req.session.flash = 'Enlace nuevo generado. El anterior ya no funciona.';
  }
  res.redirect(`/admin/sesion/${req.params.id}#compartir`);
});

// ---------- Rondas: el profesor abre la evaluación de quien expone ----------
r.post('/sesion/:id/ronda', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (!s) return res.redirect('/admin/sesiones');
  const p = q.participantePorId(Number(req.body.participante));
  if (!s.abierta) req.session.flashError = 'La sesión está cerrada. Ábrela para iniciar una ronda.';
  else if (!p || p.sesion_id !== s.id) req.session.flashError = 'Elige a quien expone.';
  else {
    q.abrirRonda(s.id, p.id);
    req.session.flash = `Ronda abierta: los compañeros ya pueden evaluar a ${p.nombre}.`;
  }
  res.redirect(`/admin/sesion/${s.id}`);
});

r.post('/sesion/:id/ronda/cerrar', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (!s) return res.redirect('/admin/sesiones');
  const ronda = q.estadoRonda(s.id);
  q.cerrarRonda(s.id);
  if (ronda.expositor) req.session.flash = `Ronda de ${ronda.expositor.nombre} cerrada con ${ronda.recibidas} de ${ronda.esperadas} evaluaciones.`;
  res.redirect(`/admin/sesion/${s.id}`);
});

// Avance de la ronda en vivo para el panel del profesor
r.get('/sesion/:id/ronda.json', requiereAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ronda = q.estadoRonda(Number(req.params.id));
  if (!ronda) return res.status(404).json({ error: 'sesión no encontrada' });
  res.json({ expositorId: ronda.expositor ? ronda.expositor.id : null, recibidas: ronda.recibidas, esperadas: ronda.esperadas });
});

r.post('/sesion/:id/rubrica', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (!s) return res.redirect('/admin/sesiones');
  const rg = q.rubricaGeneralId();
  const mensajes = [];
  if (req.body.umbral !== undefined) {
    const u = leerUmbral(req.body.umbral);
    if (u == null) {
      req.session.flashError = 'El umbral de aprobación debe ser un número entre 1 y 100.';
      return res.redirect(`/admin/sesion/${s.id}#rubrica`);
    }
    if (u !== s.umbral) { q.cambiarUmbral(s.id, u); mensajes.push(`Umbral de aprobación: más de ${u} puntos.`); }
  }
  if (req.body.rubrica === 'propia' && s.rubrica_general) {
    q.usarRubrica(s.id, q.copiarRubrica(rg, `Rúbrica de ${s.nombre}`));
    mensajes.push('La sesión ahora tiene su propia rúbrica, copiada de la general.');
  } else if (req.body.rubrica === 'general' && !s.rubrica_general) {
    q.usarRubrica(s.id, rg);
    q.borrarRubricaSiHuerfana(s.rubrica_id);
    mensajes.push('La sesión ahora usa la rúbrica general.');
  }
  req.session.flash = mensajes.length ? mensajes.join(' ') : 'Sin cambios en la rúbrica ni en el umbral.';
  res.redirect(`/admin/sesion/${s.id}#rubrica`);
});

// ---------- Lista de participantes de una sesión ----------
r.post('/sesion/:id/participantes', requiereAdmin, (req, res) => {
  const s = q.sesion(Number(req.params.id));
  if (!s) return res.redirect('/admin/sesiones');
  const nombre = limpiarNombre(req.body.nombre);
  const matricula = limpiarMatricula(req.body.matricula);
  if (!nombre || !matricula) req.session.flashError = 'Escribe el nombre completo y la matrícula.';
  else if (!matriculaValida(matricula)) req.session.flashError = 'La matrícula solo puede tener letras, números o guiones (de 3 a 30).';
  else if (q.participanteEnSesion(s.id, matricula)) req.session.flashError = `La matrícula ${matricula} ya está en esta sesión.`;
  else {
    q.crearParticipante(s.id, nombre, matricula);
    req.session.flash = `${nombre} agregado a la lista.`;
  }
  res.redirect(`/admin/sesion/${s.id}#lista`);
});

r.post('/sesion/:id/importar', requiereAdmin, (req, res, next) => {
  subida.single('archivo')(req, res, async (err) => {
    const s = q.sesion(Number(req.params.id));
    if (!s) return res.redirect('/admin/sesiones');
    const volver = `/admin/sesion/${s.id}#lista`;
    if (err) {
      req.session.flashError = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 2 MB.' : 'No se pudo recibir el archivo.';
      return res.redirect(volver);
    }
    if (!req.file) {
      req.session.flashError = 'Elige un archivo Excel (.xlsx) o CSV para importar.';
      return res.redirect(volver);
    }
    try {
      const { validas, omitidas, conEncabezado } = await leerLista(req.file.buffer, req.file.originalname);
      const r = q.importarLista(s.id, validas, req.body.actualizar === '1');
      req.session.importe = {
        archivo: String(req.file.originalname).slice(0, 80), conEncabezado,
        ...r, omitidas: omitidas.slice(0, 12), totalOmitidas: omitidas.length,
      };
      if (!validas.length && !omitidas.length) req.session.flashError = 'El archivo no tiene filas con datos.';
    } catch (e) {
      req.session.flashError = e.message || 'No se pudo leer el archivo.';
    }
    res.redirect(volver);
  });
});

r.post('/participante/:id/editar', requiereAdmin, (req, res) => {
  const p = q.participantePorId(Number(req.params.id));
  if (!p) return res.redirect('/admin/participantes');
  const nombre = limpiarNombre(req.body.nombre);
  const matricula = limpiarMatricula(req.body.matricula);
  const otro = matricula ? q.participanteEnSesion(p.sesion_id, matricula) : null;
  if (!nombre || !matricula) req.session.flashError = 'El nombre y la matrícula no pueden quedar vacíos.';
  else if (!matriculaValida(matricula)) req.session.flashError = 'La matrícula solo puede tener letras, números o guiones (de 3 a 30).';
  else if (otro && otro.id !== p.id) req.session.flashError = `La matrícula ${matricula} ya la tiene ${otro.nombre} en esta sesión.`;
  else {
    q.actualizarParticipante(p.id, nombre, matricula);
    req.session.flash = 'Participante actualizado.';
  }
  res.redirect(String(req.body.volver || '').startsWith('/admin/') ? req.body.volver : `/admin/sesion/${p.sesion_id}#lista`);
});

// Olvidó su contraseña: vuelve a la inicial (su matrícula) y deberá crear una nueva al entrar
r.post('/participante/:id/clave', requiereAdmin, (req, res) => {
  const p = q.participantePorId(Number(req.params.id));
  if (!p) return res.redirect('/admin/participantes');
  q.guardarClaveParticipante(p.id, null);
  req.session.flash = `Contraseña de ${p.nombre} restablecida: ahora entra con su matrícula (${p.matricula}) y crea una nueva.`;
  res.redirect(String(req.body.volver || '').startsWith('/admin/') ? req.body.volver : `/admin/participante/${p.id}`);
});

r.get('/plantilla.xlsx', requiereAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-participantes.xlsx"');
  res.send(Buffer.from(await plantilla()));
});

// ---------- Rúbricas ----------
r.get('/rubrica', requiereAdmin, (req, res) => res.redirect(`/admin/rubrica/${q.rubricaGeneralId()}`));

function vistaRubrica(res, rub, extra = {}, status = 200) {
  res.status(status).render('admin/rubrica', {
    ...base(rub.general ? 'rubrica' : 'sesiones'),
    rub,
    usadaPor: q.sesionesDeRubrica(rub.id),
    criterios: q.todosCriterios(rub.id),
    suma: q.sumaActivos(rub.id),
    error: null,
    ...extra,
  });
}

r.get('/rubrica/:id', requiereAdmin, (req, res) => {
  const rub = q.rubrica(Number(req.params.id));
  if (!rub) return res.redirect('/admin/rubrica');
  vistaRubrica(res, rub);
});

r.post('/rubrica/:id', requiereAdmin, (req, res) => {
  const rub = q.rubrica(Number(req.params.id));
  if (!rub) return res.redirect('/admin/rubrica');
  const b = req.body;
  const arr = (k) => [].concat(b[k] ?? []);
  const ids = arr('id'), noms = arr('nombre'), descs = arr('descripcion'), ords = arr('orden'), keys = arr('key');
  const opc = [1, 2, 3, 4, 5].map((k) => arr('p' + k));
  const descs5 = [1, 2, 3, 4, 5].map((k) => arr('d' + k)); // descriptor de cada nivel
  const descriptor = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, 1000);
  const activos = new Set(arr('activo').map(String));
  const filas = [];
  for (let i = 0; i < noms.length; i++) {
    const nombre = String(noms[i] || '').trim().slice(0, 120);
    const descripcion = String(descs[i] || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
    if (!nombre && !descripcion && !ids[i]) continue;
    const pts = opc.map((col) => redondear(Number(String(col[i] ?? '').replace(',', '.'))));
    const desc = descs5.map((col) => descriptor(col[i]));
    filas.push({ id: ids[i] ? Number(ids[i]) : null, nombre, descripcion, pts, p1: pts[0], p2: pts[1], p3: pts[2], p4: pts[3], p5: pts[4], desc, d1: desc[0], d2: desc[1], d3: desc[2], d4: desc[3], d5: desc[4], puntos: pts[4], orden: Number(ords[i]) || i + 1, activo: activos.has(String(keys[i] ?? ids[i])) });
  }
  const errores = [];
  if (filas.some((f) => !f.nombre)) errores.push('Todos los criterios necesitan nombre.');
  const malos = filas.filter((f) => f.pts.some((v) => !Number.isFinite(v) || v < 0) || !(f.pts[4] > 0));
  if (malos.length) errores.push(`Revisa los puntos de ${malos.map((f) => '"' + (f.nombre || 'sin nombre') + '"').join(', ')}: deben ser números de 0 en adelante y "${ESCALA[4]}" mayor que 0.`);
  const desordenados = filas.filter((f) => f.pts.some((v, k) => k > 0 && v < f.pts[k - 1]));
  if (desordenados.length) errores.push(`En ${desordenados.map((f) => '"' + f.nombre + '"').join(', ')} los puntos deben ir de menor a mayor, de "${ESCALA[0]}" a "${ESCALA[4]}".`);
  const suma = Math.round(filas.filter((f) => f.activo).reduce((s, f) => s + f.puntos, 0) * 100) / 100;
  if (Math.abs(suma - 100) > 0.001) errores.push(`Con "${ESCALA[4]}" en todos los criterios activos se deben obtener 100 puntos; ahora se obtienen ${suma}.`);
  if (errores.length) {
    return vistaRubrica(res, rub, { criterios: filas.map((f, i) => ({ ...f, id: f.id || '', _key: f.id || `nuevo${i}` })), suma, error: errores.join(' ') }, 400);
  }
  q.guardarRubrica(rub.id, filas);
  req.session.flash = 'Rúbrica guardada.';
  res.redirect(`/admin/rubrica/${rub.id}`);
});

r.post('/criterio/:id/borrar', requiereAdmin, (req, res) => {
  const c = q.criterio(Number(req.params.id));
  if (!c) return res.redirect('/admin/rubrica');
  q.borrarCriterio(c.id);
  req.session.flash = 'Criterio eliminado. Revisa que los criterios activos sigan sumando 100.';
  res.redirect(`/admin/rubrica/${c.rubrica_id}`);
});

// ---------- Participantes ----------
r.get('/participantes', requiereAdmin, (req, res) => {
  const f = leerFiltro(req, false);
  res.render('admin/participantes', { ...base('participantes', f), filas: q.resultados(f).map((x) => ({ ...x, estado: estadoDe(x) })) });
});

r.get('/participante/:id', requiereAdmin, (req, res) => {
  const p = q.participantePorId(Number(req.params.id));
  if (!p) return res.redirect('/admin/participantes');
  const resumen = q.resultadoDe(p.id);
  const evs = q.evaluaciones({}, p.id);
  res.render('admin/participante', {
    ...base('participantes'),
    p, resumen: { ...resumen, umbral: p.umbral }, estado: estadoDe({ ...resumen, umbral: p.umbral }),
    recibidas: evs.filter((e) => e.evaluado_id === p.id),
    hechas: evs.filter((e) => e.evaluador_id === p.id),
    desglose: q.desgloseDe(p.id, p.rubrica_id),
  });
});

r.post('/participante/:id/borrar', requiereAdmin, (req, res) => {
  const p = q.participantePorId(Number(req.params.id));
  if (!p) return res.redirect('/admin/participantes');
  const volver = /^\/admin\/(participantes|sesion\/)/.test(String(req.body.volver || '')) ? req.body.volver : '/admin/participantes';
  if (!confirmado(req, p.matricula)) return res.redirect(req.body.desde === 'detalle' ? `/admin/participante/${p.id}` : volver);
  q.borrarParticipante(p.id);
  req.session.flash = `${p.nombre} fue eliminado junto con sus evaluaciones.`;
  res.redirect(volver);
});

// ---------- Evaluaciones ----------
r.get('/evaluaciones', requiereAdmin, (req, res) => {
  const f = leerFiltro(req, false);
  res.render('admin/evaluaciones', { ...base('evaluaciones', f), evaluaciones: q.evaluaciones(f) });
});

r.post('/evaluacion/:id/borrar', requiereAdmin, (req, res) => {
  q.borrarEvaluacion(Number(req.params.id));
  req.session.flash = 'Evaluación eliminada.';
  const volver = String(req.body.volver || '');
  res.redirect(volver.startsWith('/admin/') ? volver : '/admin/evaluaciones');
});

r.post('/reiniciar-evaluaciones', requiereAdmin, (req, res) => {
  const f = { sesionId: Number(req.body.sesion) || null };
  const volver = '/admin/evaluaciones' + (f.sesionId ? `?sesion=${f.sesionId}` : '');
  if (!confirmado(req, 'BORRAR')) return res.redirect(volver);
  q.borrarEvaluaciones(f);
  req.session.flash = f.sesionId ? 'Se borraron las evaluaciones de la sesión y se reiniciaron sus rondas.' : 'Se borraron todas las evaluaciones y se reiniciaron las rondas.';
  res.redirect(volver);
});

// ---------- Configuración ----------
r.get('/configuracion', requiereAdmin, (req, res) => {
  res.render('admin/configuracion', { ...base('configuracion'), error: null });
});

r.post('/configuracion/clave', requiereAdmin, (req, res) => {
  const { actual, nueva, repetir } = req.body;
  const fallo = (error) => res.status(400).render('admin/configuracion', { ...base('configuracion'), error });
  if (!verificarClave(actual)) return fallo('La contraseña actual no es correcta.');
  if (String(nueva || '').length < 8) return fallo('La nueva contraseña debe tener al menos 8 caracteres.');
  if (nueva !== repetir) return fallo('La nueva contraseña y su repetición no coinciden.');
  if (nueva === actual) return fallo('La nueva contraseña debe ser distinta de la actual.');
  cambiarClave(nueva);
  req.session.adminVer = versionClave(); // esta sesión sigue abierta; las demás se cierran
  req.session.flash = 'Contraseña actualizada. Las demás sesiones de administrador se cerraron.';
  res.redirect('/admin/configuracion');
});

// ---------- Exportar a Excel ----------
r.get('/exportar.xlsx', requiereAdmin, async (req, res, next) => {
  try {
    const f = leerFiltro(req, false);
    const buf = await generarExcel(cfg(), estadoDe, f);
    const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const parte = f.sesion ? slug(f.sesion.nombre) : 'todas-las-sesiones';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="heteroevaluacion-${parte}-${hoy()}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    next(e);
  }
});

module.exports = r;
