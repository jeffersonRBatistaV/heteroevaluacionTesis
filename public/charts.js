/* Gráficos SVG del dashboard (sin librerías).
   Especificación: barras ≤ 24px con extremo redondeado 4px y base recta, rejilla de 1px,
   una sola serie (sin leyenda), etiqueta solo en el valor máximo, tooltip al pasar o enfocar. */
(function () {
  const nodo = document.getElementById('datos-dashboard');
  if (!nodo) return;
  const datos = JSON.parse(nodo.textContent);
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, padre) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (padre) padre.appendChild(e);
    return e;
  }
  function texto(padre, x, y, t, attrs) {
    const e = el('text', Object.assign({ x, y }, attrs || {}), padre);
    e.textContent = t;
    return e;
  }
  // Barra vertical: esquinas superiores redondeadas, base recta
  function columna(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  // Barra horizontal: extremo derecho redondeado, base izquierda recta
  function fila(x, y, w, h) {
    const r = Math.min(4, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  function pasos(max) {
    if (max <= 4) return { tope: Math.max(1, max), paso: 1 };
    const paso = Math.ceil(max / 4);
    return { tope: paso * 4, paso };
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function tooltip(cont) {
    const t = document.createElement('div');
    t.className = 'tip';
    t.setAttribute('role', 'status');
    cont.appendChild(t);
    return {
      mostrar(html, x, y) {
        t.innerHTML = html;
        t.classList.add('on');
        const cw = cont.clientWidth, tw = t.offsetWidth, th = t.offsetHeight;
        let left = x + 14, top = y - th - 10;
        if (left + tw > cw) left = Math.max(0, x - tw - 14);
        if (top < -10) top = y + 16;
        t.style.left = left + 'px';
        t.style.top = top + 'px';
      },
      ocultar() { t.classList.remove('on'); },
    };
  }

  function conectar(hit, cont, tip, html, marca, centro) {
    const enfocar = (ev) => {
      marca && marca.parentNode.querySelectorAll('.mark').forEach((m) => m !== marca && m.classList.add('dim'));
      const rc = cont.getBoundingClientRect();
      if (ev && ev.clientX != null) tip.mostrar(html, ev.clientX - rc.left, ev.clientY - rc.top);
      else tip.mostrar(html, centro[0], centro[1]);
    };
    const salir = () => {
      marca && marca.parentNode.querySelectorAll('.mark').forEach((m) => m.classList.remove('dim'));
      tip.ocultar();
    };
    hit.addEventListener('pointermove', enfocar);
    hit.addEventListener('pointerleave', salir);
    hit.addEventListener('focus', () => enfocar(null));
    hit.addEventListener('blur', salir);
  }

  function vacio(cont, msg) {
    cont.innerHTML = `<div class="vacio" style="padding:48px 12px"><span>${esc(msg)}</span></div>`;
  }

  // ---------- Columnas (histograma y evaluaciones por día) ----------
  function columnas(cont, items, opts) {
    cont.innerHTML = '';
    const W = Math.max(280, cont.clientWidth), H = opts.alto || 230;
    const m = { t: 22, r: 8, b: 30, l: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(0, ...items.map((d) => d.n));
    const { tope, paso } = opts.escala ? { tope: opts.escala, paso: opts.escala / 4 } : pasos(max);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': cont.getAttribute('aria-label') || '' }, cont);
    const tip = tooltip(cont);
    const y = (v) => m.t + ih - (v / tope) * ih;

    for (let v = 0; v <= tope; v += paso) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'base-l' : 'grid-l' }, svg);
      texto(svg, m.l - 8, y(v) + 4, v, { 'text-anchor': 'end', class: 'num' });
    }
    const banda = iw / items.length;
    const bw = Math.min(24, banda * 0.62);
    const cadaN = Math.max(1, Math.ceil(items.length / Math.floor(iw / 46)));
    const iMax = items.findIndex((d) => d.n === max && max > 0);
    const marcas = el('g', {}, svg);

    items.forEach((d, i) => {
      const cx = m.l + banda * i + banda / 2;
      if (d.n > 0) {
        const h = Math.max(2, (d.n / tope) * ih);
        el('path', { d: columna(cx - bw / 2, m.t + ih - h, bw, h), class: 'mark' }, marcas);
      }
      if (i % cadaN === 0 || i === items.length - 1) texto(svg, cx, H - m.b + 18, d.etiqueta, { 'text-anchor': 'middle' });
      if (i === iMax) texto(svg, cx, y(d.n) - 7, d.n, { 'text-anchor': 'middle', class: 'valor-txt' });
      const hit = el('rect', { x: m.l + banda * i, y: m.t, width: banda, height: ih, class: 'hit', tabindex: 0, 'aria-label': `${d.etiqueta}: ${d.n}` }, svg);
      const marca = marcas.lastElementChild && d.n > 0 ? marcas.lastElementChild : null;
      conectar(hit, cont, tip, d.tip(d), marca, [cx, y(d.n)]);
    });

    if (opts.umbralY != null) {
      const uy = y(opts.umbralY);
      el('line', { x1: m.l, x2: W - m.r, y1: uy, y2: uy, class: 'umbral-l' }, svg);
      texto(svg, W - m.r, uy - 6, opts.umbralTxt, { 'text-anchor': 'end', class: 'umbral-t' });
    }
    if (opts.umbralX != null) {
      const ux = m.l + opts.umbralX * iw;
      el('line', { x1: ux, x2: ux, y1: m.t - 6, y2: m.t + ih, class: 'umbral-l' }, svg);
      texto(svg, ux + 6, m.t - 9, opts.umbralTxt, { 'text-anchor': ux > W * 0.75 ? 'end' : 'start', class: 'umbral-t' });
    }
  }

  // ---------- Barras horizontales (cumplimiento por criterio) ----------
  function barras(cont, items) {
    cont.innerHTML = '';
    const W = Math.max(280, cont.clientWidth);
    const fh = 46, bh = 12, valW = 44;
    const H = items.length * fh + 4;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': cont.getAttribute('aria-label') || '' }, cont);
    const tip = tooltip(cont);
    const iw = W - valW;
    const pistas = el('g', {}, svg);
    const marcas = el('g', {}, svg);
    const iMax = items.reduce((b, d, i) => (d.pct > items[b].pct ? i : b), 0);
    items.forEach((d, i) => {
      const y0 = i * fh;
      texto(svg, 0, y0 + 15, d.nombre.length > 46 ? d.nombre.slice(0, 45) + '…' : d.nombre, { class: 'nombre-txt' });
      el('rect', { x: 0, y: y0 + 24, width: iw, height: bh, rx: 4, class: 'track' }, pistas);
      const w = (d.pct / 100) * iw;
      if (w > 0) el('path', { d: fila(0, y0 + 24, Math.max(w, 4), bh), class: 'mark' }, marcas);
      texto(svg, W, y0 + 34, d.pct + '%', { 'text-anchor': 'end', class: 'valor-txt' + (i === iMax ? '' : '') });
      const hit = el('rect', { x: 0, y: y0, width: W, height: fh, class: 'hit', tabindex: 0, 'aria-label': `${d.nombre}: ${d.pct}%` }, svg);
      const marca = w > 0 ? marcas.lastElementChild : null;
      conectar(hit, cont, tip,
        `<strong>${esc(d.nombre)}</strong><div class="fila-t">Promedio <b>${d.promedio ?? '—'} de ${d.puntos} pts</b></div><div class="fila-t">Rendimiento <b>${d.pct}%</b></div>` + (window.ESCALA || []).map((t, i) => `<div class="fila-t">${t} <b>${d.conteo[i]}</b></div>`).join(''),
        marca, [Math.max(w, 20), y0 + 24]);
    });
  }

  // ---------- Montaje ----------
  const fmtDia = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}`; };
  const render = {
    histograma(c) {
      if (!datos.tramos.some((t) => t.n)) return vacio(c, 'Aparecerá cuando haya participantes con evaluaciones.');
      columnas(c, datos.tramos.map((t) => Object.assign({}, t, {
        tip: (d) => `<strong>Promedio ${d.etiqueta}</strong><div class="fila-t">Participantes <b>${d.n}</b></div>` +
          (d.nombres.length ? `<div class="muted" style="margin-top:4px">${d.nombres.slice(0, 6).map(esc).join(', ')}${d.nombres.length > 6 ? '…' : ''}</div>` : ''),
      })), datos.umbral != null ? { umbralX: datos.umbral / 100, umbralTxt: `Aprueba con más de ${datos.umbral}` } : {});
    },
    sesiones(c) {
      columnas(c, datos.porSesion.map((g) => ({
        etiqueta: g.nombre.length > 14 ? g.nombre.slice(0, 13) + '…' : g.nombre, n: g.n,
        tip: () => `<strong>${esc(g.nombre)}</strong><div class="fila-t">Promedio <b>${g.conNota ? g.n : '—'}</b></div><div class="fila-t">Participantes <b>${g.participantes}</b></div><div class="fila-t">Con nota <b>${g.conNota}</b></div><div class="fila-t">Umbral <b>más de ${g.umbral}</b></div>`,
      })), { escala: 100 });
    },
    criterios(c) {
      if (!datos.criterios) return vacio(c, 'Elige una sesión en el filtro para ver sus criterios.');
      if (!datos.criterios.length) return vacio(c, 'No hay criterios activos.');
      if (!datos.criterios.some((x) => x.n)) return vacio(c, 'Aparecerá cuando se registre la primera evaluación.');
      barras(c, datos.criterios);
    },
    dias(c) {
      if (!datos.porDia.length) return vacio(c, 'Aparecerá cuando se registre la primera evaluación.');
      // Completa los días sin evaluaciones entre el primero y el último (máx. 60)
      const ini = new Date(datos.porDia[0].dia + 'T00:00:00Z'), fin = new Date(datos.porDia[datos.porDia.length - 1].dia + 'T00:00:00Z');
      const mapa = Object.fromEntries(datos.porDia.map((d) => [d.dia, d.n]));
      const items = [];
      for (let t = ini; t <= fin; t = new Date(t.getTime() + 864e5)) {
        const iso = t.toISOString().slice(0, 10);
        items.push({ dia: iso, etiqueta: fmtDia(iso), n: mapa[iso] || 0 });
      }
      const ult = items.slice(-60);
      while (ult.length < 7) {
        const p = new Date(new Date(ult[0].dia + 'T00:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
        ult.unshift({ dia: p, etiqueta: fmtDia(p), n: 0 });
      }
      columnas(c, ult.map((d) => Object.assign(d, { tip: (x) => `<strong>${x.dia.split('-').reverse().join('/')}</strong><div class="fila-t">Evaluaciones <b>${x.n}</b></div>` })), { alto: 200 });
    },
  };

  const charts = document.querySelectorAll('[data-chart]');
  const dibujar = () => charts.forEach((c) => render[c.dataset.chart] && render[c.dataset.chart](c));
  dibujar();
  let ancho = window.innerWidth, t;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - ancho) < 4) return;
    ancho = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(dibujar, 120);
  });
})();
