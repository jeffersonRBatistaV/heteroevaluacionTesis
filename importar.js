// Lee una lista de participantes desde un Excel (.xlsx) o CSV.
// Busca las columnas por su encabezado: "Nombre" (o "Nombre completo", "Estudiante", "Alumno"),
// opcionalmente "Apellidos", y "Matrícula" (o "ID", "Código", "Carnet").
// Sin encabezados reconocibles, toma la columna A como nombre y la B como matrícula.
const ExcelJS = require('exceljs');

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const limpiarNombre = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
const limpiarMatricula = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toUpperCase().slice(0, 30);
const matriculaValida = (m) => /^[A-Z0-9-]{3,30}$/.test(m);

function textoCelda(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v);
}

// CSV con comillas; separador , o ; (el que más aparezca en la primera línea)
function leerCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

async function leerFilas(buffer, nombreArchivo) {
  const ext = String(nombreArchivo || '').toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') return leerCSV(buffer.toString('utf8'));
  if (ext !== 'xlsx') throw new Error('Sube un archivo .xlsx (Excel) o .csv.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('No se pudo leer el Excel. Guárdalo como .xlsx e inténtalo de nuevo.');
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const filas = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let c = 1; c <= row.cellCount; c++) vals.push(textoCelda(row.getCell(c).value));
    filas.push(vals);
  });
  return filas;
}

function detectarColumnas(encabezado) {
  const h = encabezado.map(norm);
  const mat = h.findIndex((x) => /matricula|carnet|codigo|cedula/.test(x) || x === 'id' || x.startsWith('id '));
  const ape = h.findIndex((x) => x.includes('apellido'));
  let nom = h.findIndex((x, i) => i !== ape && (x.includes('nombre') || x.includes('estudiante') || x.includes('alumno') || x.includes('participante')));
  if (mat >= 0 && nom >= 0) return { nom, ape, mat, conEncabezado: true };
  return null;
}

// Devuelve { validas: [{nombre, matricula, fila}], omitidas: [{fila, motivo, texto}] }
async function leerLista(buffer, nombreArchivo) {
  const filas = (await leerFilas(buffer, nombreArchivo)).filter((f) => f.some((c) => String(c).trim()));
  if (!filas.length) throw new Error('El archivo está vacío.');
  let cols = detectarColumnas(filas[0]);
  let inicio = 1;
  if (!cols) { cols = { nom: 0, ape: -1, mat: 1, conEncabezado: false }; inicio = 0; }

  const validas = [], omitidas = [], vistas = new Set();
  for (let i = inicio; i < filas.length; i++) {
    const f = filas[i];
    const nFila = i + 1;
    let nombre = limpiarNombre(f[cols.nom]);
    if (cols.ape >= 0 && f[cols.ape]) nombre = limpiarNombre(`${nombre} ${f[cols.ape]}`);
    const matricula = limpiarMatricula(f[cols.mat]);
    const texto = [nombre, matricula].filter(Boolean).join(' · ') || '(vacía)';
    if (!nombre) { omitidas.push({ fila: nFila, motivo: 'falta el nombre', texto }); continue; }
    if (!matricula) { omitidas.push({ fila: nFila, motivo: 'falta la matrícula', texto }); continue; }
    if (!matriculaValida(matricula)) { omitidas.push({ fila: nFila, motivo: 'matrícula no válida (solo letras, números o guiones, de 3 a 30)', texto }); continue; }
    if (vistas.has(matricula)) { omitidas.push({ fila: nFila, motivo: 'matrícula repetida en el archivo', texto }); continue; }
    vistas.add(matricula);
    validas.push({ nombre, matricula, fila: nFila });
  }
  return { validas, omitidas, conEncabezado: cols.conEncabezado };
}

async function plantilla() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Participantes');
  ws.columns = [{ header: 'Nombre completo', key: 'n', width: 36 }, { header: 'Matrícula', key: 'm', width: 18 }];
  ws.addRow({ n: 'María Pérez Gómez', m: '2021-0456' });
  ws.addRow({ n: 'Juan Rodríguez Díaz', m: '2021-0789' });
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2357C6' } };
  ws.getColumn('m').numFmt = '@';
  return wb.xlsx.writeBuffer();
}

module.exports = { leerLista, plantilla, limpiarNombre, limpiarMatricula, matriculaValida, norm };
