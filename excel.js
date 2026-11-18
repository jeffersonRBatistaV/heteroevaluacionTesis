const ExcelJS = require('exceljs');
const { q } = require('./db');
const { ESCALA } = require('./escala');
// Relleno de celda por opción, de Deficiente (rojo claro) a Excelente (verde claro)
const TONO = ['FFFBE3E3', 'FFFCEEDC', 'FFF6F3D9', 'FFE6F2E3', 'FFD8EFD8'];

const AZUL = 'FF2357C6';
const VERDE = { fg: 'FFE4F4E4', ink: 'FF006300' };
const ROJO = { fg: 'FFFBE9E9', ink: 'FFB42828' };
const AMBAR = { fg: 'FFFDF3DC', ink: 'FF8A5A00' };
const BORDE = { style: 'thin', color: { argb: 'FFE2E6EE' } };

function encabezado(ws, congelarCol = 0) {
  const fila = ws.getRow(1);
  fila.height = 30;
  fila.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: congelarCol }];
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: ws.columnCount } };
}
function bordes(ws) {
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = { bottom: BORDE };
      c.alignment = { vertical: 'top', wrapText: true, ...(c.alignment || {}) };
    });
  });
}
function pintarEstado(cell, estado) {
  const p = estado === 'Aprobado' ? VERDE : estado === 'Reprobado' ? ROJO : AMBAR;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p.fg } };
  cell.font = { bold: true, color: { argb: p.ink } };
}
const etiqueta = (e) => (e === 'aprobado' ? 'Aprobado' : e === 'reprobado' ? 'Reprobado' : 'Pendiente');
const ddmm = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

async function generarExcel({ nota, min }, estadoDe, f) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Heteroevaluación de Tesis';
  wb.created = new Date();

  const resultados = q.resultados(f).map((x) => ({ ...x, estado: etiqueta(estadoDe(x)) }));
  const evaluaciones = q.evaluaciones(f);
  const conNota = resultados.filter((x) => x.promedio != null);
  const rubricaId = f.sesion ? f.sesion.rubrica_id : null; // una sola rúbrica solo si hay una sesión elegida
  const criterios = rubricaId ? q.criteriosActivos(rubricaId) : [];
  const alcance = f.sesion ? `${f.sesion.nombre} · ${ddmm(f.sesion.fecha)}` : 'Todas las sesiones';

  // --- Resumen ---
  const wsR = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: AZUL } } });
  wsR.columns = [{ width: 42 }, { width: 26 }];
  wsR.addRow(['Heteroevaluación de Tesis']).font = { bold: true, size: 16, color: { argb: AZUL } };
  wsR.addRow([alcance]).font = { bold: true, size: 12 };
  wsR.addRow([`Generado el ${new Date().toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' })}`]).font = { italic: true, color: { argb: 'FF7B8597' } };
  wsR.addRow([]);
  [
    ['Participantes', resultados.length],
    ['Evaluaciones realizadas', evaluaciones.length],
    ['Promedio general', conNota.length ? Math.round((conNota.reduce((s, x) => s + x.promedio, 0) / conNota.length) * 100) / 100 : '—'],
    ['Aprobados', resultados.filter((x) => x.estado === 'Aprobado').length],
    ['Reprobados', resultados.filter((x) => x.estado === 'Reprobado').length],
    ['Pendientes (sin evaluaciones suficientes)', resultados.filter((x) => x.estado === 'Pendiente').length],
    ['Umbral de aprobación (más de)', f.sesion ? f.sesion.umbral : 'Según cada sesión'],
    ['Evaluaciones mínimas para tener estado', min],
  ].forEach(([k, v]) => {
    const row = wsR.addRow([k, v]);
    row.getCell(1).font = { color: { argb: 'FF4A5568' } };
    row.getCell(2).font = { bold: true, size: 12 };
    row.getCell(2).alignment = { horizontal: 'right' };
    row.eachCell((c) => (c.border = { bottom: BORDE }));
  });

  // Resumen por sesión
  const grupos = new Map();
  resultados.forEach((x) => {
    const k = x.sesion_id;
    if (!grupos.has(k)) grupos.set(k, { sesion: x.sesion_nombre, fecha: x.sesion_fecha, n: 0, notas: [], ap: 0 });
    const g = grupos.get(k);
    g.n++;
    if (x.promedio != null) g.notas.push(x.promedio);
    if (x.estado === 'Aprobado') g.ap++;
  });
  if (grupos.size) {
    wsR.addRow([]);
    const h = wsR.addRow(['Sesión', 'Participantes · promedio · aprobados']);
    h.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }; });
    [...grupos.values()].forEach((g) => {
      const prom = g.notas.length ? Math.round((g.notas.reduce((a, b) => a + b, 0) / g.notas.length) * 100) / 100 : '—';
      const row = wsR.addRow([`${g.sesion} (${ddmm(g.fecha)})`, `${g.n} · ${prom} · ${g.ap}`]);
      row.eachCell((c) => (c.border = { bottom: BORDE }));
      row.getCell(2).alignment = { horizontal: 'right' };
    });
  }

  // --- Resultados ---
  const ws1 = wb.addWorksheet('Resultados');
  ws1.columns = [
    { header: '#', key: 'pos', width: 6 },
    { header: 'Sesión', key: 'ses', width: 22 },
    { header: 'Fecha sesión', key: 'fs', width: 13 },
    { header: 'Matrícula', key: 'mat', width: 16 },
    { header: 'Nombre', key: 'nom', width: 32 },
    { header: 'Evaluaciones recibidas', key: 'rec', width: 13 },
    { header: 'Evaluaciones hechas', key: 'hec', width: 13 },
    { header: 'Promedio', key: 'prom', width: 11 },
    { header: 'Umbral', key: 'umb', width: 9 },
    { header: 'Estado', key: 'est', width: 13 },
    { header: 'Registrado (UTC)', key: 'reg', width: 19 },
  ];
  resultados.forEach((x, i) => {
    const row = ws1.addRow({ pos: i + 1, ses: x.sesion_nombre, fs: ddmm(x.sesion_fecha), mat: x.matricula, nom: x.nombre, rec: x.n_eval, hec: x.hechas, prom: x.promedio ?? null, umb: x.umbral, est: x.estado, reg: x.creado_en });
    row.getCell('prom').numFmt = '0.00';
    row.getCell('prom').font = { bold: true };
    pintarEstado(row.getCell('est'), x.estado);
  });
  encabezado(ws1);
  bordes(ws1);

  // --- Evaluaciones (registro; con matriz de criterios si hay una sola rúbrica) ---
  const ws2 = wb.addWorksheet('Evaluaciones');
  ws2.columns = [
    { header: 'ID', key: 'id', width: 7 },
    { header: 'Fecha (UTC)', key: 'fecha', width: 19 },
    { header: 'Sesión', key: 'ses', width: 20 },
    { header: 'Matrícula evaluador', key: 'em', width: 16 },
    { header: 'Evaluador', key: 'en', width: 28 },
    { header: 'Matrícula evaluado', key: 'dm', width: 16 },
    { header: 'Evaluado', key: 'dn', width: 28 },
    { header: 'Puntaje', key: 'pt', width: 10 },
    ...(criterios.length
      ? criterios.map((c) => ({ header: `${c.nombre} (máx. ${c.puntos})`, key: `c${c.id}`, width: 20 }))
      : [{ header: 'Calificación por criterio', key: 'crit', width: 70 }]),
  ];
  evaluaciones.forEach((e) => {
    // selecciones: "criterio:opcion:puntos,…"
    const sel = Object.fromEntries(String(e.selecciones || '').split(',').filter(Boolean).map((t) => { const [c, o, pt] = t.split(':'); return [Number(c), { o: Number(o), pt: Number(pt) }]; }));
    const d = { id: e.id, fecha: e.actualizado_en, ses: e.sesion_nombre, em: e.evaluador_mat, en: e.evaluador, dm: e.evaluado_mat, dn: e.evaluado, pt: e.puntaje_total, crit: e.criterios || '' };
    criterios.forEach((c) => (d[`c${c.id}`] = sel[c.id] ? `${ESCALA[sel[c.id].o - 1]} (${sel[c.id].pt})` : '—'));
    const row = ws2.addRow(d);
    row.getCell('pt').font = { bold: true };
    criterios.forEach((c) => {
      const cell = row.getCell(`c${c.id}`);
      cell.alignment = { horizontal: 'center' };
      if (sel[c.id]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TONO[sel[c.id].o - 1] } };
      else cell.font = { color: { argb: 'FFB0B7C3' } };
    });
  });
  encabezado(ws2, 8);
  bordes(ws2);

  // --- Cumplimiento por criterio y rúbrica (solo con una sesión elegida) ---
  if (rubricaId) {
    const ws3 = wb.addWorksheet('Por criterio');
    ws3.columns = [
      { header: 'Criterio', key: 'n', width: 34 },
      { header: 'Máximo', key: 'p', width: 9 },
      { header: 'Puntos promedio', key: 'prom', width: 15 },
      { header: '% del máximo', key: 'pct', width: 14 },
      { header: 'Calificaciones', key: 't', width: 14 },
      ...ESCALA.map((t, i) => ({ header: t, key: 'o' + i, width: 12 })),
      { header: 'Más elegida', key: 'fr', width: 14 },
    ];
    q.cumplimientoCriterios(rubricaId, f).forEach((c) => {
      const fila = { n: c.nombre, p: c.puntos, prom: c.promedio ?? null, pct: c.pct / 100, t: c.n, fr: c.frecuente || '—' };
      c.conteo.forEach((v, i) => (fila['o' + i] = v));
      const row = ws3.addRow(fila);
      row.getCell('pct').numFmt = '0%';
      row.getCell('prom').numFmt = '0.00';
    });
    encabezado(ws3);
    bordes(ws3);
    if (ws3.rowCount > 1) {
      ws3.addConditionalFormatting({
        ref: `D2:D${ws3.rowCount}`,
        rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FF2A78D6' }, gradient: false }],
      });
    }

    const ws4 = wb.addWorksheet('Rúbrica');
    ws4.columns = [
      { header: 'Orden', key: 'o', width: 8 },
      { header: 'Criterio', key: 'n', width: 32 },
      { header: 'Descripción', key: 'd', width: 70 },
      ...ESCALA.map((t, i) => ({ header: t, key: 'p' + (i + 1), width: 12 })),
      { header: 'Activo', key: 'a', width: 9 },
    ];
    q.todosCriterios(rubricaId).forEach((c) => ws4.addRow({ o: c.orden, n: c.nombre, d: c.descripcion, p1: c.p1, p2: c.p2, p3: c.p3, p4: c.p4, p5: c.p5, a: c.activo ? 'Sí' : 'No' }));
    encabezado(ws4);
    bordes(ws4);
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { generarExcel };
