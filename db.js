const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { ESCALA, REPARTO, puntosDe, redondear } = require('./escala');
const { RUBRICA_UNAPEC, NOMBRES_EJEMPLO } = require('./rubrica-unapec');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(dataDir, 'app.db'));

const hoy = () => new Date().toISOString().slice(0, 10);
// Código corto para el enlace de una sesión (sin caracteres ambiguos)
function nuevoCodigo() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), (b) => abc[b % abc.length]).join('');
}

// Modelo: una SESIÓN es un ciclo de evaluación (nombre, fecha, rúbrica, abierta/cerrada, enlace).
// Cada estudiante pertenece a una sola sesión y evalúa a los demás integrantes de esa sesión.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS rubricas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    general INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    fecha TEXT NOT NULL,
    rubrica_id INTEGER NOT NULL REFERENCES rubricas(id),
    abierta INTEGER NOT NULL DEFAULT 1,
    codigo TEXT,
    umbral REAL NOT NULL DEFAULT 80,
    modo TEXT NOT NULL DEFAULT 'turnos',
    expositor_id INTEGER,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS participantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sesion_id INTEGER NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    matricula TEXT NOT NULL COLLATE NOCASE,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    ultimo_ingreso TEXT,
    UNIQUE (sesion_id, matricula)
  );

  CREATE TABLE IF NOT EXISTS criterios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rubrica_id INTEGER NOT NULL REFERENCES rubricas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL DEFAULT '',
    descripcion TEXT NOT NULL DEFAULT '',
    puntos REAL NOT NULL CHECK (puntos > 0),
    p1 REAL, p2 REAL, p3 REAL, p4 REAL, p5 REAL,
    orden INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS evaluaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluador_id INTEGER NOT NULL REFERENCES participantes(id) ON DELETE CASCADE,
    evaluado_id INTEGER NOT NULL REFERENCES participantes(id) ON DELETE CASCADE,
    puntaje_total REAL NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (evaluador_id, evaluado_id),
    CHECK (evaluador_id <> evaluado_id)
  );

  CREATE TABLE IF NOT EXISTS evaluacion_criterios (
    evaluacion_id INTEGER NOT NULL REFERENCES evaluaciones(id) ON DELETE CASCADE,
    criterio_id INTEGER NOT NULL REFERENCES criterios(id) ON DELETE CASCADE,
    opcion INTEGER NOT NULL DEFAULT 5 CHECK (opcion BETWEEN 1 AND 5),
    puntos REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (evaluacion_id, criterio_id)
  );
`);

// ---------- Migraciones desde versiones anteriores ----------
const columnas = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const existeTabla = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

function rubricaGeneralId() {
  let r = db.prepare('SELECT id FROM rubricas WHERE general = 1 ORDER BY id LIMIT 1').get();
  if (!r) r = { id: Number(db.prepare("INSERT INTO rubricas (nombre, general) VALUES ('Rúbrica general', 1)").run().lastInsertRowid) };
  return r.id;
}

db.exec('PRAGMA foreign_keys = OFF');
{
  if (!columnas('participantes').includes('matricula')) {
    db.exec('ALTER TABLE participantes ADD COLUMN matricula TEXT');
    db.exec("UPDATE participantes SET matricula = 'SIN-' || id WHERE matricula IS NULL");
  }
  if (!columnas('criterios').includes('nombre')) {
    db.exec("ALTER TABLE criterios ADD COLUMN nombre TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE criterios SET nombre = 'Criterio ' || orden WHERE nombre = ''");
  }
  if (!columnas('criterios').includes('rubrica_id')) {
    db.exec(`ALTER TABLE criterios ADD COLUMN rubrica_id INTEGER NOT NULL DEFAULT ${rubricaGeneralId()}`);
  }
  if (!columnas('sesiones').includes('codigo')) db.exec('ALTER TABLE sesiones ADD COLUMN codigo TEXT');

  const colsP = columnas('participantes');
  if (colsP.includes('grupo_id') && !colsP.includes('sesion_id')) {
    // v5: los grupos desaparecen. El primer grupo de cada sesión se funde con ella;
    // cada grupo adicional pasa a ser una sesión propia (mismo estado y rúbrica).
    db.exec('BEGIN');
    db.exec('CREATE TEMP TABLE mapa_grupos (grupo_id INTEGER PRIMARY KEY, sesion_id INTEGER NOT NULL)');
    const insMapa = db.prepare('INSERT INTO mapa_grupos (grupo_id, sesion_id) VALUES (?, ?)');
    for (const s of db.prepare('SELECT * FROM sesiones').all()) {
      const grupos = db.prepare('SELECT * FROM grupos WHERE sesion_id = ? ORDER BY fecha, nombre, id').all(s.id);
      grupos.forEach((g, i) => {
        if (i === 0) return insMapa.run(g.id, s.id);
        const nueva = db.prepare('INSERT INTO sesiones (nombre, fecha, rubrica_id, abierta, codigo) VALUES (?, ?, ?, ?, ?)')
          .run(`${s.nombre} · ${g.nombre}`, g.fecha, s.rubrica_id, s.abierta, nuevoCodigo()).lastInsertRowid;
        insMapa.run(g.id, Number(nueva));
      });
    }
    db.exec(`
      CREATE TABLE participantes_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sesion_id INTEGER NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        matricula TEXT NOT NULL UNIQUE COLLATE NOCASE,
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO participantes_nueva (id, sesion_id, nombre, matricula, creado_en)
        SELECT p.id, m.sesion_id, p.nombre, p.matricula, p.creado_en
          FROM participantes p JOIN mapa_grupos m ON m.grupo_id = p.grupo_id;
      DROP TABLE participantes;
      ALTER TABLE participantes_nueva RENAME TO participantes;
      DROP TABLE grupos;
      DROP TABLE mapa_grupos;
    `);
    db.exec('COMMIT');
  } else if (!colsP.includes('sesion_id')) {
    // Versiones sin sesiones: todos pasan a una sesión inicial
    const s = db.prepare('INSERT INTO sesiones (nombre, fecha, rubrica_id) VALUES (?, ?, ?)').run('Sesión 1', hoy(), rubricaGeneralId()).lastInsertRowid;
    db.exec(`ALTER TABLE participantes ADD COLUMN sesion_id INTEGER NOT NULL DEFAULT ${Number(s)}`);
  }
  if (existeTabla('grupos') && !columnas('participantes').includes('grupo_id')) db.exec('DROP TABLE grupos');
  db.exec('CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');

  // v6: lista de participantes por sesión (la cargó el admin). Matrícula única por sesión y registro de ingreso.
  if (!columnas('participantes').includes('ultimo_ingreso')) {
    db.exec(`
      BEGIN;
      CREATE TABLE participantes_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sesion_id INTEGER NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        matricula TEXT NOT NULL COLLATE NOCASE,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        ultimo_ingreso TEXT,
        UNIQUE (sesion_id, matricula)
      );
      INSERT INTO participantes_nueva (id, sesion_id, nombre, matricula, creado_en, ultimo_ingreso)
        SELECT id, sesion_id, nombre, matricula, creado_en, creado_en FROM participantes;
      DROP TABLE participantes;
      ALTER TABLE participantes_nueva RENAME TO participantes;
      COMMIT;
    `);
  }
}
{
  if (!columnas('criterios').includes('p1')) {
    for (const k of ['p1', 'p2', 'p3', 'p4', 'p5']) db.exec(`ALTER TABLE criterios ADD COLUMN ${k} REAL`);
  }
  db.exec(`UPDATE criterios SET p1 = ROUND(puntos * 0.2, 2), p2 = ROUND(puntos * 0.4, 2), p3 = ROUND(puntos * 0.6, 2),
           p4 = ROUND(puntos * 0.8, 2), p5 = puntos WHERE p5 IS NULL`);
  if (!columnas('evaluacion_criterios').includes('opcion')) {
    db.exec('ALTER TABLE evaluacion_criterios ADD COLUMN opcion INTEGER NOT NULL DEFAULT 5');
    db.exec('ALTER TABLE evaluacion_criterios ADD COLUMN puntos REAL NOT NULL DEFAULT 0');
    db.exec('UPDATE evaluacion_criterios SET opcion = 5, puntos = (SELECT c.puntos FROM criterios c WHERE c.id = criterio_id)');
  }
}
db.exec('PRAGMA foreign_keys = ON');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sesiones_codigo ON sesiones(codigo)');
db.exec('CREATE INDEX IF NOT EXISTS participantes_sesion ON participantes(sesion_id)');
// v9: umbral de aprobación propio de cada sesión (lo elige el profesor junto con la rúbrica)
if (!columnas('sesiones').includes('umbral')) db.exec(`ALTER TABLE sesiones ADD COLUMN umbral REAL NOT NULL DEFAULT ${Number(process.env.NOTA_APROBACION || 80)}`);
// v8: el tutorial se muestra solo la primera vez que cada persona entra
if (!columnas('participantes').includes('tutorial_visto')) db.exec('ALTER TABLE participantes ADD COLUMN tutorial_visto INTEGER NOT NULL DEFAULT 0');
// v10: evaluación por turnos (el profesor abre la ronda de quien expone) y observaciones en cada evaluación.
// Todas las sesiones son por turnos: solo se evalúa al expositor de la ronda abierta.
if (!columnas('sesiones').includes('modo')) db.exec("ALTER TABLE sesiones ADD COLUMN modo TEXT NOT NULL DEFAULT 'turnos'");
db.exec("UPDATE sesiones SET modo = 'turnos' WHERE modo <> 'turnos'");
if (!columnas('sesiones').includes('expositor_id')) db.exec('ALTER TABLE sesiones ADD COLUMN expositor_id INTEGER');
// Momento en que se abrió por primera vez la ronda del participante (null = aún no expone)
if (!columnas('participantes').includes('expuso_en')) db.exec('ALTER TABLE participantes ADD COLUMN expuso_en TEXT');
if (!columnas('evaluaciones').includes('comentario')) db.exec("ALTER TABLE evaluaciones ADD COLUMN comentario TEXT NOT NULL DEFAULT ''");
// v11: acceso con matrícula y contraseña. Sin clave propia (null), la contraseña inicial es la matrícula
// y el estudiante debe crear la suya al entrar por primera vez.
if (!columnas('participantes').includes('clave')) db.exec('ALTER TABLE participantes ADD COLUMN clave TEXT');
// v12: descriptor de cada nivel en cada criterio (d1 = No aceptable … d5 = Excelente)
for (const k of ['d1', 'd2', 'd3', 'd4', 'd5']) {
  if (!columnas('criterios').includes(k)) db.exec(`ALTER TABLE criterios ADD COLUMN ${k} TEXT NOT NULL DEFAULT ''`);
}

// ---------- Datos iniciales ----------
// Carga la rúbrica UNAPEC en una rúbrica (reemplaza sus criterios). Puntos de cada nivel = peso × nivel / 4.
function cargarRubricaUnapec(rubricaId) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM criterios WHERE rubrica_id = ?').run(rubricaId);
    const ins = db.prepare(
      `INSERT INTO criterios (rubrica_id, nombre, descripcion, puntos, p1, p2, p3, p4, p5, d1, d2, d3, d4, d5, orden, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );
    RUBRICA_UNAPEC.forEach((c, i) => {
      const pts = REPARTO.map((f) => redondear(c.peso * f));
      ins.run(rubricaId, c.nombre, c.descripcion, c.peso, ...pts, ...c.d, i + 1);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
const RG = rubricaGeneralId();
{
  // La general pasa a la UNAPEC si está vacía o sigue siendo la de ejemplo; si el profesor la editó, no se toca
  const nombres = db.prepare('SELECT nombre FROM criterios WHERE rubrica_id = ? ORDER BY orden, id').all(RG).map((c) => c.nombre);
  const esEjemplo = nombres.length === NOMBRES_EJEMPLO.length && nombres.every((n, i) => n === NOMBRES_EJEMPLO[i]);
  if (!nombres.length || esEjemplo) cargarRubricaUnapec(RG);
}
if (db.prepare('SELECT COUNT(*) AS n FROM sesiones').get().n === 0) {
  db.prepare('INSERT INTO sesiones (nombre, fecha, rubrica_id) VALUES (?, ?, ?)').run('Sesión 1', hoy(), RG);
}
for (const s of db.prepare('SELECT id FROM sesiones WHERE codigo IS NULL').all()) {
  db.prepare('UPDATE sesiones SET codigo = ? WHERE id = ?').run(nuevoCodigo(), s.id);
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const ESCALA_SQL = ESCALA.map((t, i) => `WHEN ${i + 1} THEN '${t}'`).join(' ');

// Filtro opcional por sesión sobre el alias de participantes indicado
const filtro = ({ sesionId } = {}, alias = 'p') => (sesionId ? ` AND ${alias}.sesion_id = ${Number(sesionId)}` : '');

const q = {
  rubricaGeneralId: () => RG,

  // ---------- Sesiones ----------
  sesiones: () =>
    db.prepare(
      `SELECT s.*, r.nombre AS rubrica_nombre, r.general AS rubrica_general,
              (SELECT COUNT(*) FROM participantes p WHERE p.sesion_id = s.id) AS n_participantes,
              (SELECT COUNT(*) FROM evaluaciones e JOIN participantes p ON p.id = e.evaluado_id WHERE p.sesion_id = s.id) AS n_evaluaciones
         FROM sesiones s JOIN rubricas r ON r.id = s.rubrica_id
        ORDER BY s.fecha DESC, s.id DESC`
    ).all(),
  sesion: (id) =>
    db.prepare(
      `SELECT s.*, r.nombre AS rubrica_nombre, r.general AS rubrica_general,
              (SELECT COUNT(*) FROM participantes p WHERE p.sesion_id = s.id) AS n_participantes,
              (SELECT COUNT(*) FROM evaluaciones e JOIN participantes p ON p.id = e.evaluado_id WHERE p.sesion_id = s.id) AS n_evaluaciones
         FROM sesiones s JOIN rubricas r ON r.id = s.rubrica_id WHERE s.id = ?`
    ).get(id),
  // Sesiones abiertas, para el selector del ingreso (por fecha)
  sesionesAbiertas: () => db.prepare('SELECT id, nombre, fecha, codigo, abierta, umbral FROM sesiones ORDER BY abierta DESC, fecha DESC, nombre').all(),
  crearSesion: (nombre, fecha, rubricaId, umbral = 80) =>
    Number(db.prepare("INSERT INTO sesiones (nombre, fecha, rubrica_id, codigo, umbral, modo) VALUES (?, ?, ?, ?, ?, 'turnos')").run(nombre, fecha, rubricaId, nuevoCodigo(), umbral).lastInsertRowid),
  cambiarUmbral: (id, umbral) => db.prepare('UPDATE sesiones SET umbral = ? WHERE id = ?').run(umbral, id),
  actualizarSesion: (id, nombre, fecha, abierta) =>
    db.prepare('UPDATE sesiones SET nombre = ?, fecha = ?, abierta = ? WHERE id = ?').run(nombre, fecha, abierta ? 1 : 0, id),
  borrarSesion: (id) =>
    tx(() => {
      const s = q.sesion(id);
      db.prepare('DELETE FROM participantes WHERE sesion_id = ?').run(id);
      db.prepare('DELETE FROM sesiones WHERE id = ?').run(id);
      if (s && !s.rubrica_general) q.borrarRubricaSiHuerfana(s.rubrica_id);
    }),
  sesionPorCodigo: (codigo) => db.prepare('SELECT * FROM sesiones WHERE codigo = ?').get(String(codigo || '').toUpperCase()),
  regenerarCodigo: (id) => db.prepare('UPDATE sesiones SET codigo = ? WHERE id = ?').run(nuevoCodigo(), id),

  // ---------- Rondas: el profesor abre la evaluación de quien expone ----------
  abrirRonda: (sesionId, participanteId) =>
    tx(() => {
      db.prepare('UPDATE sesiones SET expositor_id = ? WHERE id = ?').run(participanteId, sesionId);
      db.prepare("UPDATE participantes SET expuso_en = COALESCE(expuso_en, datetime('now')) WHERE id = ? AND sesion_id = ?").run(participanteId, sesionId);
    }),
  cerrarRonda: (sesionId) => db.prepare('UPDATE sesiones SET expositor_id = NULL WHERE id = ?').run(sesionId),
  // Quién expone ahora y cuántos compañeros ya lo evaluaron
  estadoRonda: (sesionId) => {
    const s = db.prepare('SELECT id, abierta, expositor_id FROM sesiones WHERE id = ?').get(sesionId);
    if (!s) return null;
    const n = db.prepare('SELECT COUNT(*) AS n, COUNT(expuso_en) AS expusieron FROM participantes WHERE sesion_id = ?').get(sesionId);
    const ex = s.expositor_id ? db.prepare('SELECT id, nombre, matricula FROM participantes WHERE id = ? AND sesion_id = ?').get(s.expositor_id, sesionId) : null;
    return {
      abierta: !!s.abierta, expositor: ex || null,
      recibidas: ex ? db.prepare('SELECT COUNT(*) AS n FROM evaluaciones WHERE evaluado_id = ?').get(ex.id).n : 0,
      esperadas: Math.max(0, n.n - 1), participantes: n.n, expusieron: n.expusieron,
    };
  },

  // ---------- Rúbricas ----------
  rubrica: (id) => db.prepare('SELECT * FROM rubricas WHERE id = ?').get(id),
  sesionesDeRubrica: (id) => db.prepare('SELECT id, nombre FROM sesiones WHERE rubrica_id = ? ORDER BY fecha DESC').all(id),
  copiarRubrica: (origenId, nombre) =>
    tx(() => {
      const id = Number(db.prepare('INSERT INTO rubricas (nombre, general) VALUES (?, 0)').run(nombre).lastInsertRowid);
      db.prepare(
        `INSERT INTO criterios (rubrica_id, nombre, descripcion, puntos, p1, p2, p3, p4, p5, d1, d2, d3, d4, d5, orden, activo)
         SELECT ?, nombre, descripcion, puntos, p1, p2, p3, p4, p5, d1, d2, d3, d4, d5, orden, activo FROM criterios WHERE rubrica_id = ?`
      ).run(id, origenId);
      return id;
    }),
  usarRubrica: (sesionId, rubricaId) => db.prepare('UPDATE sesiones SET rubrica_id = ? WHERE id = ?').run(rubricaId, sesionId),
  borrarRubricaSiHuerfana: (id) => {
    const r = q.rubrica(id);
    if (!r || r.general) return;
    if (db.prepare('SELECT COUNT(*) AS n FROM sesiones WHERE rubrica_id = ?').get(id).n === 0) db.prepare('DELETE FROM rubricas WHERE id = ?').run(id);
  },

  // ---------- Criterios ----------
  criteriosActivos: (rubricaId) => db.prepare('SELECT * FROM criterios WHERE rubrica_id = ? AND activo = 1 ORDER BY orden, id').all(rubricaId),
  todosCriterios: (rubricaId) => db.prepare('SELECT * FROM criterios WHERE rubrica_id = ? ORDER BY activo DESC, orden, id').all(rubricaId),
  sumaActivos: (rubricaId) => db.prepare('SELECT COALESCE(SUM(puntos),0) AS s FROM criterios WHERE rubrica_id = ? AND activo = 1').get(rubricaId).s,
  guardarRubrica: (rubricaId, filas) =>
    tx(() => {
      const upd = db.prepare('UPDATE criterios SET nombre = ?, descripcion = ?, puntos = ?, p1 = ?, p2 = ?, p3 = ?, p4 = ?, p5 = ?, d1 = ?, d2 = ?, d3 = ?, d4 = ?, d5 = ?, orden = ?, activo = ? WHERE id = ? AND rubrica_id = ?');
      const ins = db.prepare('INSERT INTO criterios (rubrica_id, nombre, descripcion, puntos, p1, p2, p3, p4, p5, d1, d2, d3, d4, d5, orden, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const f of filas) {
        const a = f.activo ? 1 : 0;
        const [p1, p2, p3, p4, p5] = f.pts;
        const desc = (f.desc || []).concat(['', '', '', '', '']).slice(0, 5);
        if (f.id) upd.run(f.nombre, f.descripcion, p5, p1, p2, p3, p4, p5, ...desc, f.orden, a, f.id, rubricaId);
        else ins.run(rubricaId, f.nombre, f.descripcion, p5, p1, p2, p3, p4, p5, ...desc, f.orden, a);
      }
    }),
  criterio: (id) => db.prepare('SELECT * FROM criterios WHERE id = ?').get(id),
  borrarCriterio: (id) => db.prepare('DELETE FROM criterios WHERE id = ?').run(id),

  // ---------- Participantes ----------
  participantePorId: (id) =>
    db.prepare(
      `SELECT p.*, s.nombre AS sesion_nombre, s.fecha AS sesion_fecha, s.abierta, s.rubrica_id, s.umbral, s.expositor_id
         FROM participantes p JOIN sesiones s ON s.id = p.sesion_id WHERE p.id = ?`
    ).get(id),
  // Todas las inscripciones de una matrícula (puede estar en varias sesiones): abiertas y recientes primero
  inscripcionesDe: (matricula) =>
    db.prepare(
      `SELECT p.*, s.nombre AS sesion_nombre, s.abierta, s.fecha AS sesion_fecha
         FROM participantes p JOIN sesiones s ON s.id = p.sesion_id
        WHERE p.matricula = ? ORDER BY s.abierta DESC, s.fecha DESC, s.id DESC`
    ).all(matricula),
  participanteEnSesion: (sesionId, matricula) =>
    db.prepare('SELECT * FROM participantes WHERE sesion_id = ? AND matricula = ?').get(sesionId, matricula),
  crearParticipante: (sesionId, nombre, matricula) =>
    Number(db.prepare('INSERT INTO participantes (sesion_id, nombre, matricula) VALUES (?, ?, ?)').run(sesionId, nombre, matricula).lastInsertRowid),
  actualizarParticipante: (id, nombre, matricula) =>
    db.prepare('UPDATE participantes SET nombre = ?, matricula = ? WHERE id = ?').run(nombre, matricula, id),
  // clave: hash "scrypt$…" o null para volver a la contraseña inicial (la matrícula)
  guardarClaveParticipante: (id, clave) => db.prepare('UPDATE participantes SET clave = ? WHERE id = ?').run(clave, id),
  // Cambia la contraseña en todas las inscripciones de la matrícula que compartían la anterior
  cambiarClaveMatricula: (matricula, anterior, nueva) =>
    db.prepare('UPDATE participantes SET clave = ? WHERE matricula = ? AND clave = ?').run(nueva, matricula, anterior),
  marcarTutorialVisto: (id) => db.prepare('UPDATE participantes SET tutorial_visto = 1 WHERE id = ?').run(id),
  leerConfig: (k) => db.prepare('SELECT valor FROM config WHERE clave = ?').get(k)?.valor ?? null,
  escribirConfig: (k, v) => db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(k, String(v)),
  marcarIngreso: (id) => db.prepare("UPDATE participantes SET ultimo_ingreso = datetime('now') WHERE id = ?").run(id),
  borrarParticipante: (id) =>
    tx(() => {
      db.prepare('UPDATE sesiones SET expositor_id = NULL WHERE expositor_id = ?').run(id);
      db.prepare('DELETE FROM participantes WHERE id = ?').run(id);
    }),
  // Agrega varias filas {nombre, matricula} a la lista de una sesión. Las matrículas que ya están se actualizan
  // solo si se pide; si no, se informan como omitidas.
  importarLista: (sesionId, filas, actualizar) =>
    tx(() => {
      const r = { agregados: 0, actualizados: 0, sinCambios: 0 };
      const buscar = db.prepare('SELECT id, nombre FROM participantes WHERE sesion_id = ? AND matricula = ?');
      const ins = db.prepare('INSERT INTO participantes (sesion_id, nombre, matricula) VALUES (?, ?, ?)');
      const upd = db.prepare('UPDATE participantes SET nombre = ? WHERE id = ?');
      for (const f of filas) {
        const ya = buscar.get(sesionId, f.matricula);
        if (!ya) { ins.run(sesionId, f.nombre, f.matricula); r.agregados++; }
        else if (actualizar && ya.nombre !== f.nombre) { upd.run(f.nombre, ya.id); r.actualizados++; }
        else r.sinCambios++;
      }
      return r;
    }),

  // ---------- Evaluaciones ----------
  evaluacionDe: (evaluadorId, evaluadoId) =>
    db.prepare('SELECT * FROM evaluaciones WHERE evaluador_id = ? AND evaluado_id = ?').get(evaluadorId, evaluadoId),
  // { criterio_id: opcion } de una evaluación
  seleccionesDe: (evaluacionId) =>
    Object.fromEntries(db.prepare('SELECT criterio_id, opcion FROM evaluacion_criterios WHERE evaluacion_id = ?').all(evaluacionId).map((r) => [r.criterio_id, r.opcion])),
  // selecciones: { criterio_id: opcion 1..5 }. Devuelve null si falta calificar algún criterio activo.
  guardarEvaluacion: (evaluadorId, evaluadoId, rubricaId, selecciones, comentario = '') =>
    tx(() => {
      const criterios = q.criteriosActivos(rubricaId);
      const elegidos = criterios.map((c) => ({ c, op: Number(selecciones[c.id]) }));
      if (elegidos.some((x) => !(x.op >= 1 && x.op <= 5))) return null;
      const validos = elegidos.map(({ c, op }) => ({ id: c.id, op, pts: puntosDe(c)[op - 1] }));
      const total = redondear(validos.reduce((s, v) => s + v.pts, 0));
      const existente = q.evaluacionDe(evaluadorId, evaluadoId);
      let evId;
      if (existente) {
        evId = existente.id;
        db.prepare("UPDATE evaluaciones SET puntaje_total = ?, comentario = ?, actualizado_en = datetime('now') WHERE id = ?").run(total, comentario, evId);
        db.prepare('DELETE FROM evaluacion_criterios WHERE evaluacion_id = ?').run(evId);
      } else {
        evId = db.prepare('INSERT INTO evaluaciones (evaluador_id, evaluado_id, puntaje_total, comentario) VALUES (?, ?, ?, ?)').run(evaluadorId, evaluadoId, total, comentario).lastInsertRowid;
      }
      const ins = db.prepare('INSERT INTO evaluacion_criterios (evaluacion_id, criterio_id, opcion, puntos) VALUES (?, ?, ?, ?)');
      validos.forEach((v) => ins.run(evId, v.id, v.op, v.pts));
      return total;
    }),
  borrarEvaluacion: (id) => db.prepare('DELETE FROM evaluaciones WHERE id = ?').run(id),
  // Borra las evaluaciones y reinicia las rondas (nadie ha expuesto) de una sesión o de todas
  borrarEvaluaciones: (f = {}) =>
    tx(() => {
      db.exec(`DELETE FROM evaluaciones WHERE evaluado_id IN (SELECT p.id FROM participantes p WHERE 1=1 ${filtro(f)})`);
      db.exec(`UPDATE participantes SET expuso_en = NULL WHERE 1=1 ${filtro(f, 'participantes')}`);
      db.exec(`UPDATE sesiones SET expositor_id = NULL WHERE 1=1 ${f.sesionId ? `AND id = ${Number(f.sesionId)}` : ''}`);
    }),
  // Observaciones que recibió alguien, sin datos del autor y en orden alfabético para no delatarlo
  comentariosDe: (id) =>
    db.prepare("SELECT comentario FROM evaluaciones WHERE evaluado_id = ? AND comentario <> '' ORDER BY comentario").all(id).map((r) => r.comentario),

  // Compañeros de la misma sesión, con lo que el visitante ya les dio
  listaParaEvaluador: (u) =>
    db.prepare(
      `SELECT p.id, p.nombre, p.expuso_en,
              (SELECT COUNT(*) FROM evaluaciones e WHERE e.evaluado_id = p.id) AS n_eval,
              (SELECT puntaje_total FROM evaluaciones e WHERE e.evaluado_id = p.id AND e.evaluador_id = ?) AS mi_puntaje
         FROM participantes p WHERE p.sesion_id = ? AND p.id <> ? ORDER BY p.nombre`
    ).all(u.id, u.sesion_id, u.id),

  resultados: (f = {}) =>
    db.prepare(
      `SELECT p.id, p.nombre, p.matricula, p.creado_en, p.ultimo_ingreso, p.sesion_id, p.expuso_en, (p.clave IS NOT NULL) AS clave_propia,
              s.nombre AS sesion_nombre, s.fecha AS sesion_fecha, s.umbral,
              COUNT(e.id) AS n_eval,
              ROUND(AVG(e.puntaje_total), 2) AS promedio,
              (SELECT COUNT(*) FROM evaluaciones h WHERE h.evaluador_id = p.id) AS hechas
         FROM participantes p
         JOIN sesiones s ON s.id = p.sesion_id
         LEFT JOIN evaluaciones e ON e.evaluado_id = p.id
        WHERE 1=1 ${filtro(f)}
        GROUP BY p.id
        ORDER BY ${f.orden === 'nombre' ? 'p.nombre' : 'promedio IS NULL, promedio DESC, p.nombre'}`
    ).all(),

  resultadoDe: (id) =>
    db.prepare('SELECT COUNT(*) AS n_eval, ROUND(AVG(puntaje_total), 2) AS promedio FROM evaluaciones WHERE evaluado_id = ?').get(id),

  desgloseDe: (id, rubricaId) => q.rendimientoCriterios(rubricaId, `AND e.evaluado_id = ${Number(id)}`),

  // Por criterio activo: n calificaciones, puntos promedio, % del máximo y cuántas veces se eligió cada opción
  rendimientoCriterios: (rubricaId, where = '') => {
    const criterios = q.criteriosActivos(rubricaId);
    const filas = db.prepare(
      `SELECT ec.criterio_id, ec.opcion, COUNT(*) AS n, SUM(ec.puntos) AS pts
         FROM evaluacion_criterios ec JOIN evaluaciones e ON e.id = ec.evaluacion_id
         JOIN participantes p ON p.id = e.evaluado_id
        WHERE 1=1 ${where} GROUP BY ec.criterio_id, ec.opcion`
    ).all();
    return criterios.map((c) => {
      const conteo = [0, 0, 0, 0, 0];
      let n = 0, pts = 0;
      filas.filter((f) => f.criterio_id === c.id).forEach((f) => { conteo[f.opcion - 1] += f.n; n += f.n; pts += f.pts; });
      const promedio = n ? redondear(pts / n) : null;
      return {
        id: c.id, nombre: c.nombre, descripcion: c.descripcion, puntos: c.puntos, opciones: puntosDe(c),
        n, conteo, promedio, pct: n && c.puntos ? Math.round((pts / n / c.puntos) * 100) : 0,
        frecuente: n ? ESCALA[conteo.indexOf(Math.max(...conteo))] : null,
      };
    });
  },

  // Registro de evaluaciones; `persona` limita a las hechas o recibidas por alguien
  evaluaciones: (f = {}, persona) =>
    db.prepare(
      `SELECT e.id, e.puntaje_total, e.comentario, e.creado_en, e.actualizado_en, e.evaluador_id, e.evaluado_id,
              (SELECT GROUP_CONCAT(ec.criterio_id || ':' || ec.opcion || ':' || ec.puntos) FROM evaluacion_criterios ec WHERE ec.evaluacion_id = e.id) AS selecciones,
              (SELECT GROUP_CONCAT(c.nombre || ': ' || CASE ec.opcion ${ESCALA_SQL} END || ' (' || (ec.opcion - 1) || '), ' || printf('%g', ec.puntos) || ' pts', ' · ')
                 FROM evaluacion_criterios ec JOIN criterios c ON c.id = ec.criterio_id
                WHERE ec.evaluacion_id = e.id ORDER BY c.orden) AS criterios,
              a.nombre AS evaluador, a.matricula AS evaluador_mat,
              b.nombre AS evaluado, b.matricula AS evaluado_mat,
              s.nombre AS sesion_nombre
         FROM evaluaciones e
         JOIN participantes a ON a.id = e.evaluador_id
         JOIN participantes b ON b.id = e.evaluado_id
         JOIN sesiones s ON s.id = b.sesion_id
        WHERE 1=1 ${filtro(f, 'b')}
          ${persona ? `AND (e.evaluador_id = ${Number(persona)} OR e.evaluado_id = ${Number(persona)})` : ''}
        ORDER BY e.actualizado_en DESC`
    ).all(),

  // ---------- Dashboard ----------
  cumplimientoCriterios: (rubricaId, f = {}) => q.rendimientoCriterios(rubricaId, filtro(f)),
  evaluacionesPorDia: (f = {}) =>
    db.prepare(
      `SELECT date(e.creado_en) AS dia, COUNT(*) AS n
         FROM evaluaciones e JOIN participantes p ON p.id = e.evaluado_id
        WHERE 1=1 ${filtro(f)} GROUP BY dia ORDER BY dia`
    ).all(),
  conteos: (f = {}) =>
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM participantes p WHERE 1=1 ${filtro(f)}) AS participantes,
              (SELECT COUNT(*) FROM evaluaciones e JOIN participantes p ON p.id = e.evaluado_id WHERE 1=1 ${filtro(f)}) AS evaluaciones,
              (SELECT COUNT(DISTINCT e.evaluador_id) FROM evaluaciones e JOIN participantes p ON p.id = e.evaluado_id WHERE 1=1 ${filtro(f)}) AS evaluadores_activos`
    ).get(),
};

module.exports = { db, q };
