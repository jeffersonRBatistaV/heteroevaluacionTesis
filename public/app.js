(function () {
  // Avisos flotantes: los de éxito se cierran solos; los de error se quedan hasta cerrarlos
  document.querySelectorAll('.toasts .flash').forEach((t) => {
    const cerrar = () => { t.classList.add('saliendo'); setTimeout(() => t.remove(), 260); };
    t.querySelector('.cerrar')?.addEventListener('click', cerrar);
    if (t.hasAttribute('data-auto')) setTimeout(cerrar, 6000);
  });

  // Pestañas de la página de sesión: muestran una sección a la vez y siguen el # de la dirección
  const pestanas = document.getElementById('pestanas-sesion');
  if (pestanas) {
    const paneles = [...document.querySelectorAll('[data-panel-pestana]')];
    const nombres = paneles.map((p) => p.dataset.panelPestana);
    const mostrar = (nombre, enfocar) => {
      if (!nombres.includes(nombre)) nombre = 'lista';
      paneles.forEach((p) => (p.hidden = p.dataset.panelPestana !== nombre));
      pestanas.querySelectorAll('[data-pestana]').forEach((a) => {
        const on = a.dataset.pestana === nombre;
        a.classList.toggle('on', on);
        on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
      });
      if (enfocar) pestanas.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const desdeHash = (enfocar) => mostrar(location.hash.slice(1), enfocar);
    window.addEventListener('hashchange', () => desdeHash(true));
    desdeHash(false);
  }

  // El sello de "Mi resultado" se estampa con animación solo la primera vez que se ve
  const sello = document.querySelector('.sello.estampar');
  if (sello) {
    let visto = false;
    try { visto = localStorage.getItem('sello-visto') === '1'; localStorage.setItem('sello-visto', '1'); } catch (e) {}
    if (visto) sello.classList.remove('estampar');
  }

  // Evaluar con el teclado: 1 a 5 elige Deficiente…Excelente en el criterio actual y pasa al siguiente
  const formEval = document.getElementById('form-eval');
  if (formEval && !formEval.querySelector('fieldset[disabled]')) {
    const criterios = [...formEval.querySelectorAll('.crit-escala')];
    document.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || !/^[1-5]$/.test(ev.key)) return;
      if (ev.target.matches('input:not([type=radio]), textarea, select')) return;
      const actual = criterios.find((c) => c.contains(document.activeElement)) || criterios.find((c) => !c.querySelector('input:checked')) || criterios[0];
      if (!actual) return;
      ev.preventDefault();
      const radio = actual.querySelector(`input[value="${ev.key}"]`);
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      const sig = criterios[criterios.indexOf(actual) + 1];
      if (sig) { sig.querySelector('input').focus({ preventScroll: true }); sig.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else document.getElementById('btn-enviar')?.focus();
    });
  }
  // Doble validación para acciones destructivas.
  // Botón: data-confirmar="Título" data-detalle="Qué se borra" [data-escribir="texto a teclear"] [data-accion="Eliminar"]
  // Paso 1: la ventana explica las consecuencias. Paso 2: hay que escribir el texto (si se pide) para habilitar el botón.
  const dlg = document.getElementById('dlg-confirmar');
  let pendiente = null;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (dlg) {
    const titulo = dlg.querySelector('[data-d-titulo]'), detalle = dlg.querySelector('[data-d-detalle]');
    const bloque = dlg.querySelector('[data-d-escribir]'), objetivo = dlg.querySelector('[data-d-objetivo]');
    const entrada = dlg.querySelector('#d-entrada'), ok = dlg.querySelector('[data-d-ok]');
    const validar = () => { ok.disabled = !!pendiente?.dataset.escribir && norm(entrada.value) !== norm(pendiente.dataset.escribir); };
    entrada.addEventListener('input', validar);
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-confirmar]');
      if (!b || b.dataset.confirmado) return;
      ev.preventDefault();
      pendiente = b;
      titulo.textContent = b.dataset.confirmar;
      detalle.textContent = b.dataset.detalle || 'Esta acción no se puede deshacer.';
      bloque.hidden = !b.dataset.escribir;
      objetivo.textContent = b.dataset.escribir || '';
      entrada.value = '';
      ok.textContent = b.dataset.accion || 'Eliminar';
      validar();
      dlg.showModal();
      (b.dataset.escribir ? entrada : dlg.querySelector('[data-d-cancelar]')).focus();
    });
    dlg.querySelector('[data-d-cancelar]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { if (dlg.returnValue !== 'ok') pendiente = null; dlg.returnValue = ''; });
    ok.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (ok.disabled || !pendiente) return;
      const b = pendiente, form = b.form || b.closest('form');
      if (form) {
        // El texto escrito viaja al servidor, que lo vuelve a verificar
        let h = form.querySelector('input[name=confirmacion]');
        if (!h) { h = document.createElement('input'); h.type = 'hidden'; h.name = 'confirmacion'; form.appendChild(h); }
        h.value = entrada.value;
        b.dataset.confirmado = '1';
        dlg.returnValue = 'ok';
        dlg.close();
        form.requestSubmit(b.type === 'submit' || b.tagName === 'BUTTON' ? b : undefined);
      }
    });
  }

  // Copiar enlaces al portapapeles
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-copiar], [data-copiar-texto]');
    if (!b) return;
    const campo = b.dataset.copiar ? document.querySelector(b.dataset.copiar) : null;
    const valor = campo ? campo.value : b.dataset.copiarTexto;
    try { await navigator.clipboard.writeText(valor); }
    catch { if (campo) { campo.select(); document.execCommand('copy'); } }
    const orig = b.textContent;
    b.textContent = 'Copiado';
    setTimeout(() => (b.textContent = orig), 1800);
  });

  // Editar en línea una fila de la lista de participantes
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-editar]');
    if (!b) return;
    const fila = document.querySelector(`.fila-editar[data-de="${b.dataset.editar}"]`);
    if (!fila) return;
    fila.hidden = !fila.hidden;
    if (!fila.hidden) fila.querySelector('input[name=nombre]').focus();
  });

  // Conmutador Estudiante / Administrador en la pantalla de ingreso
  const ingreso = document.getElementById('ingreso');
  if (ingreso) {
    ingreso.querySelectorAll('[data-modo]').forEach((b) =>
      b.addEventListener('click', () => {
        const modo = b.dataset.modo;
        ingreso.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        ingreso.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== modo));
        // La columna de la izquierda también cambia: descripción para el estudiante o para el profesor
        document.querySelectorAll('[data-lado]').forEach((l) => (l.hidden = l.dataset.lado !== modo));
        const foco = ingreso.querySelector(`[data-panel="${modo}"] ${modo === 'admin' ? '#clave' : '#sesion'}`);
        foco && foco.focus();
      })
    );
  }

  // El filtro de sesión se aplica al cambiar
  document.querySelectorAll('form[data-autoenvio] select').forEach((s) =>
    s.addEventListener('change', () => {
      s.form.submit();
    })
  );

  // Búsqueda en listas y tablas
  const buscar = document.getElementById('buscar');
  if (buscar) {
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    buscar.addEventListener('input', () => {
      const v = norm(buscar.value.trim());
      document.querySelectorAll(buscar.dataset.filtro).forEach((n) => {
        if (!n.dataset.texto) return;
        n.hidden = v && !norm(n.dataset.texto).includes(v);
      });
    });
  }

  // Puntaje en vivo al evaluar
  const fe = document.getElementById('form-eval');
  if (fe) {
    const total = document.getElementById('total'), regla = document.getElementById('regla-eval'), ver = document.getElementById('veredicto');
    const umbral = window.UMBRAL || 80;
    const grupos = [...fe.querySelectorAll('.crit-escala')];
    const calc = () => {
      let s = 0, faltan = 0;
      grupos.forEach((g) => {
        const el = g.querySelector('input[type=radio]:checked');
        const max = g.querySelector('.o5 input')?.dataset.p;
        g.classList.toggle('falta', !el);
        if (el) s += Number(el.dataset.p); else faltan++;
        g.querySelector('[data-obtenido]').textContent = `${el ? el.dataset.p : '—'} / ${max} pts`;
      });
      s = Math.round(s * 100) / 100;
      total.textContent = s;
      regla.style.setProperty('--v', Math.min(100, s));
      const ok = s > umbral;
      regla.classList.toggle('aprobado', ok && !faltan);
      regla.classList.toggle('reprobado', !ok && !faltan);
      ver.innerHTML = faltan
        ? `<span class="muted">Falta${faltan === 1 ? '' : 'n'} ${faltan} criterio${faltan === 1 ? '' : 's'} por calificar</span>`
        : `<span class="estado ${ok ? 'aprobado' : 'reprobado'}">${ok ? 'Sobre' : 'Bajo'} el umbral de ${umbral}</span>`;
    };
    // Si intenta enviar con criterios sin calificar, lleva al primero que falta
    fe.addEventListener('submit', (ev) => {
      const pendiente = grupos.find((g) => !g.querySelector('input:checked'));
      if (pendiente) {
        ev.preventDefault();
        pendiente.classList.add('falta', 'resaltar');
        pendiente.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pendiente.querySelector('input').focus({ preventScroll: true });
        setTimeout(() => pendiente.classList.remove('resaltar'), 1600);
      }
    });
    fe.addEventListener('change', calc);
    calc();
  }

  // Editor de rúbrica: tarjetas de criterio con los puntos de las cinco opciones
  const fr = document.getElementById('form-rubrica');
  if (fr) {
    const filas = document.getElementById('filas-rubrica');
    const suma = document.getElementById('suma'), num = document.getElementById('suma-num');
    let n = 0;
    const recalcular = () => {
      let s = 0;
      filas.querySelectorAll('.crit-card').forEach((card) => {
        const chk = card.querySelector('input[name=activo]');
        if (chk && chk.checked) s += Number(card.querySelector('input[name=p5]').value || 0);
        // Aviso visual si los puntos no van de menor a mayor
        const v = [1, 2, 3, 4, 5].map((k) => Number(card.querySelector('input[name=p' + k + ']').value || 0));
        card.classList.toggle('desordenado', v.some((x, k) => k > 0 && x < v[k - 1]));
      });
      s = Math.round(s * 100) / 100;
      num.textContent = s;
      suma.className = 'suma ' + (Math.abs(s - 100) < 0.001 ? 'ok' : 'mal');
    };
    document.getElementById('agregar-criterio').addEventListener('click', () => {
      const tpl = document.getElementById('tpl-criterio').content.firstElementChild.cloneNode(true);
      const key = 'nuevo_' + Date.now().toString(36) + (n++);
      tpl.querySelector('input[name=key]').value = key;
      tpl.querySelector('input[name=activo]').value = key;
      tpl.querySelector('input[name=orden]').value = filas.querySelectorAll('.crit-card').length + 1;
      filas.appendChild(tpl);
      tpl.querySelector('input[name=nombre]').focus();
      recalcular();
    });
    filas.addEventListener('click', (ev) => {
      const quitar = ev.target.closest('[data-quitar]');
      if (quitar) { quitar.closest('.crit-card').remove(); recalcular(); return; }
      const rep = ev.target.closest('[data-repartir]');
      if (rep) {
        const card = rep.closest('.crit-card');
        const max = Number(card.querySelector('input[name=p5]').value || 0);
        [0.2, 0.4, 0.6, 0.8].forEach((f, k) => (card.querySelector('input[name=p' + (k + 1) + ']').value = Math.round(max * f * 100) / 100));
        recalcular();
      }
    });
    fr.addEventListener('input', recalcular);
    fr.addEventListener('change', recalcular);
    recalcular();
  }

  // Actualización en vivo del estudiante: cuando el profesor abre o cierra una ronda (o la sesión), la lista se recarga sola.
  // En la página de evaluar (data-solo-avisar) no se recarga, para no perder lo marcado: se avisa y se bloquea el envío.
  const vivo = document.getElementById('vivo');
  if (vivo) {
    let firma = vivo.dataset.firma, parado = false;
    const soloAvisar = vivo.hasAttribute('data-solo-avisar');
    const evaluado = Number(vivo.dataset.evaluado) || null;
    const revisar = async () => {
      if (parado || document.hidden) return;
      try {
        const r = await fetch('/estado.json', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (r.status === 401) { parado = true; return; }
        if (!r.ok) return;
        const d = await r.json();
        if (d.firma === firma) return;
        if (!soloAvisar) { parado = true; location.reload(); return; }
        firma = d.firma;
        // ¿Todavía se puede enviar la evaluación de este compañero?
        if (!d.abierta || d.expositor !== evaluado) {
          parado = true;
          const aviso = document.getElementById('aviso-ronda');
          if (aviso) { aviso.hidden = false; aviso.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
          const b = document.getElementById('btn-enviar');
          if (b) b.disabled = true;
        }
      } catch (e) { /* sin conexión: se reintenta en la siguiente vuelta */ }
    };
    setInterval(revisar, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  }

  // Panel del profesor: el conteo de evaluaciones de la ronda abierta se actualiza solo
  const ronda = document.querySelector('[data-ronda-sesion]');
  if (ronda) {
    const out = ronda.querySelector('[data-ronda-recibidas]');
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/admin/sesion/${ronda.dataset.rondaSesion}/ronda.json`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (String(d.expositorId ?? '') === ronda.dataset.expositor && out) out.textContent = d.recibidas;
      } catch (e) { /* se reintenta */ }
    }, 4000);
  }
})();
