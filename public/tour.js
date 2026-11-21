/* Tutoriales guiados con driver.js: un recorrido por página, para estudiantes y para el administrador.
   Se abre solo la primera vez en las páginas principales y siempre desde el botón "Tutorial". */
(function () {
  const ruta = location.pathname;
  const paso = (element, title, description, side) => ({ element, popover: { title, description, side: side || 'bottom', align: 'start' } });

  const TOURS = {
    // ---------- Pantalla de ingreso ----------
    ingreso: {
      pasos: [
        paso('.conmutador', 'Estudiante o administrador', 'Usa este botón para cambiar entre el ingreso de estudiante y el del administrador (profesor). Es la misma pantalla para los dos.'),
        paso('#sesion', 'Elige tu sesión', 'Elige la sesión en la que te registró tu profesor. Si entraste con su enlace, ya viene elegida.'),
        paso('#matricula', 'Tu usuario', 'Tu usuario es tu matrícula, tal como aparece en la lista del profesor.'),
        paso('#clave-est', 'Tu contraseña', 'La primera vez es tu matrícula; al entrar crearás una propia. Si la olvidas, pide a tu profesor que la restablezca.'),
        paso('[data-panel="estudiante"] .btn', 'Entrar', 'Listo: al entrar verás a tus compañeros de sesión para evaluarlos.', 'top'),
      ],
    },

    // ---------- Estudiante ----------
    participantes: {
      pasos: [
        paso('.page-head h1', 'Eres jurado', 'Aquí evalúas a tus compañeros de sesión, y ellos te evalúan a ti.'),
        paso('.siguiente', 'Tu siguiente evaluación', 'Aquí aparece quién expone ahora y el botón para evaluarlo. Cuando tu profesor abra o cierre una ronda, la página se actualiza sola.'),
        paso('.progreso-eval', 'Tu avance', 'Cuántos compañeros llevas evaluados. Tu resultado se desbloquea cuando evalúas al menos al 95 % de ellos.'),
        paso('.grid-personas li:first-child', 'Evaluar a un compañero', 'Pulsa "Evaluar" para abrir la rúbrica. Si ya lo evaluaste, verás el puntaje que le diste y podrás editarlo mientras la sesión siga abierta.'),
        paso('.nav a[href="/mi-resultado"]', 'Mi resultado', 'Tu promedio, si apruebas y cómo te calificaron en cada criterio. Solo tú puedes ver tu resultado.'),
        paso('#btn-tutorial', 'Vuelve cuando quieras', 'Este botón abre el tutorial de la página en la que estés.', 'left'),
      ],
    },
    evaluar: {
      pasos: [
        paso('.rubrica li:first-child .crit-escala', 'Califica cada criterio', 'Elige la opción que mejor describe el desempeño de tu compañero en este criterio, de No aceptable (0) a Excelente (4). Cada nivel muestra los puntos que da y qué describe.'),
        paso('.rubrica li:first-child .pts', 'Puntos del criterio', 'Los puntos que obtiene con la opción elegida, sobre el máximo del criterio.', 'left'),
        paso('.barra-eval .total', 'Puntaje en vivo', 'El total se actualiza mientras marcas.', 'top'),
        paso('#regla-eval', 'El umbral de aprobación', 'La marca vertical es la nota de aprobación. La nota final de tu compañero es el promedio de todas las evaluaciones que recibe.', 'top'),
        paso('.barra-eval .btn', 'Guardar', 'Envía la evaluación cuando hayas calificado todos los criterios. Puedes volver a editarla mientras la sesión siga abierta.', 'top'),
      ],
    },
    'mi-resultado': {
      pasos: [
        paso('#bloqueo', 'Resultado bloqueado', 'Evalúa a tus compañeros para desbloquear tu nota. Aquí ves cuántas evaluaciones te faltan.'),
        paso('.resultado-hero .sello', 'Tu nota', 'El promedio de las calificaciones que te dieron tus compañeros, sellado con tu estado.'),
        paso('.resultado-hero .regla', 'Frente al umbral', 'Apruebas si tu promedio supera la marca de aprobación.'),
        paso('.desglose', 'Desglose por criterio', 'Tus puntos promedio en cada criterio y cuántas veces te dieron cada calificación. Te muestra en qué destacas y qué puedes mejorar.', 'top'),
      ],
    },

    // ---------- Administrador ----------
    'admin-dashboard': {
      pasos: [
        paso('.lateral-nav', 'Secciones', 'Desde aquí gestionas sesiones, participantes, evaluaciones, la rúbrica general y la configuración.', 'right'),
        paso('.filtros', 'Filtra por sesión', 'Todo el dashboard (y el Excel) se ajusta a la sesión que elijas. Con "Todas las sesiones" verás el promedio de cada sesión comparado.'),
        paso('.kpis', 'Indicadores', 'Promedio general, tasa de aprobación, participantes y evaluaciones registradas.'),
        paso('[data-chart="histograma"]', 'Distribución de promedios', 'Cuántos estudiantes hay en cada tramo de nota. Pasa el cursor sobre una barra para ver quiénes son.', 'top'),
        paso('[data-chart="criterios"]', 'Rendimiento por criterio', 'Puntos promedio de cada criterio frente a su máximo. Pasa el cursor para ver cuántas veces se eligió cada opción.', 'top'),
        paso('a[href^="/admin/exportar"]', 'Exportar a Excel', 'Descarga un .xlsx con resumen, resultados, el registro de evaluaciones y el cumplimiento por criterio.', 'left'),
        paso('.lateral-nav a[href="/admin/sesiones"]', 'Empieza por una sesión', 'Crea una sesión con nombre y fecha, carga la lista de estudiantes y comparte su enlace.', 'right'),
      ],
    },
    'admin-sesiones': {
      pasos: [
        paso('.tarjetas', 'Tus sesiones', 'Cada sesión es un ciclo de evaluación. Copia su enlace, ábrela para cambiar nombre, fecha, estado o rúbrica, o elimínala desde aquí.'),
        paso('form[action="/admin/sesiones"] #s-nombre', 'Nueva sesión', 'Dale un nombre y una fecha. Los estudiantes los verán al elegir la sesión.'),
        paso('form[action="/admin/sesiones"] .opcion-rubrica', 'Rúbrica', 'Usa la rúbrica general o crea una propia para esta sesión (empieza como copia de la general).', 'top'),
      ],
    },
    'admin-sesion': {
      pasos: [
        paso('#prep', 'Lista de preparación', 'Antes de compartir el enlace revisa estos cuatro puntos: lista cargada, rúbrica que suma 100, umbral de aprobación y sesión abierta.'),
        paso('.kpis-3', 'Resumen', 'Participantes, evaluaciones y el umbral de la sesión. Haz clic para ir al detalle.'),
        paso('#pestanas-sesion', 'Secciones de la sesión', 'Participantes, enlace para compartir, rúbrica y umbral, y ajustes. Cada pestaña muestra una sección.'),
        paso('#form-importar', 'Importar desde Excel', 'Carga la lista con nombre y matrícula. Verás cuántos se agregaron y qué filas se omitieron y por qué.', 'top'),
        paso('#lista .tabla-wrap', 'Quién ya entró', 'Por cada estudiante ves si ya entró, cuántas evaluaciones recibió e hizo, y su promedio. Puedes editarlo o quitarlo.', 'top'),
      ],
    },
    'admin-rubrica': {
      pasos: [
        paso('#filas-rubrica .crit-card:first-child', 'Criterio', 'Cada criterio tiene un nombre, una descripción de lo que debe cumplir el evaluado y los puntos de cada una de sus cinco opciones.'),
        paso('#filas-rubrica .crit-card:first-child .puntos-opciones', 'Puntos por opción', 'Decide cuántos puntos da cada opción, de menor a mayor. "Repartir" llena las demás a partir del puntaje de Excelente.', 'top'),
        paso('#suma', 'Debe sumar 100', 'Con Excelente en todos los criterios activos se deben obtener exactamente 100 puntos para poder guardar.', 'top'),
        paso('#agregar-criterio', 'Agregar y guardar', 'Agrega criterios nuevos y guarda los cambios con "Guardar rúbrica".', 'top'),
      ],
    },
    'admin-participantes': {
      pasos: [
        paso('.filtros', 'Filtra', 'Muestra los participantes de una sesión.'),
        paso('#buscar', 'Busca', 'Encuentra a alguien por nombre, matrícula o sesión.'),
        paso('#tabla-part tbody tr:first-child', 'Detalle', 'Haz clic en el nombre para ver las evaluaciones que recibió y las que hizo. Para eliminar a alguien hay que escribir su matrícula.', 'top'),
      ],
    },
    'admin-configuracion': {
      pasos: [
        paso('#c-actual', 'Contraseña actual', 'Para cambiar la contraseña primero confirma la actual.'),
        paso('#c-nueva', 'Nueva contraseña', 'Mínimo 8 caracteres. Repítela en el campo de abajo.'),
        paso('#form-clave .btn', 'Guardar', 'Al guardar, cualquier otra sesión de administrador abierta se cierra.', 'top'),
      ],
    },
    'admin-evaluaciones': {
      pasos: [
        paso('.filtros', 'Filtra', 'Elige una sesión.'),
        paso('#evals', 'Registro', 'Quién evaluó a quién, con qué puntaje y qué criterios marcó.', 'top'),
        paso('.zona-peligro', 'Borrado masivo', 'Borra las evaluaciones del filtro actual (por ejemplo, si cambiaste la rúbrica). Hay que escribir BORRAR para confirmar.', 'top'),
      ],
    },
  };

  const pagina =
    ruta === '/' || ruta.startsWith('/s/') ? 'ingreso'
    : ruta === '/participantes' ? 'participantes'
    : ruta.startsWith('/evaluar/') ? 'evaluar'
    : ruta === '/mi-resultado' ? 'mi-resultado'
    : ruta === '/admin' || ruta === '/admin/' ? 'admin-dashboard'
    : ruta === '/admin/sesiones' ? 'admin-sesiones'
    : ruta.startsWith('/admin/sesion/') ? 'admin-sesion'
    : ruta.startsWith('/admin/rubrica') ? 'admin-rubrica'
    : ruta === '/admin/participantes' ? 'admin-participantes'
    : ruta === '/admin/evaluaciones' ? 'admin-evaluaciones'
    : ruta === '/admin/configuracion' ? 'admin-configuracion'
    : null;

  const tour = pagina && TOURS[pagina];
  const boton = document.getElementById('btn-tutorial');
  if (!tour || !window.driver || !window.driver.js) return;

  const visibles = () => tour.pasos.filter((p) => {
    const el = document.querySelector(p.element);
    return el && el.offsetParent !== null;
  });
  if (!visibles().length) return;

  function iniciar() {
    const d = window.driver.js.driver({
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Anterior',
      doneBtnText: 'Entendido',
      popoverClass: 'tutorial',
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      allowClose: true,
      steps: visibles(),
    });
    d.drive();
  }

  if (boton) {
    boton.hidden = false;
    boton.addEventListener('click', iniciar);
  }

  // Se abre solo una vez por persona: la primera vez que entra a su página principal
  // (lista de compañeros para el estudiante, dashboard para el profesor). El servidor recuerda que ya lo vio.
  const principal = pagina === 'participantes' || pagina === 'admin-dashboard';
  if (principal && window.TUTORIAL_PENDIENTE) {
    window.TUTORIAL_PENDIENTE = false;
    fetch('/tutorial/visto', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setTimeout(iniciar, 450);
  }
})();
