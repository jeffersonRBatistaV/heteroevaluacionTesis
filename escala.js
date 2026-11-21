// Escala de calificación de cada criterio (rúbrica UNAPEC): cinco niveles fijos, del peor al mejor.
// Internamente cada opción es 1..5; el nivel que se muestra es 0..4 (opción − 1).
// Los puntos de cada opción los define el admin en la rúbrica, criterio por criterio.
const ESCALA = ['No aceptable', 'Deficiente', 'Satisfactorio', 'Bueno', 'Excelente'];
// Reparto al crear un criterio: porcentaje de su puntaje máximo (Excelente) = nivel / 4
const REPARTO = [0, 0.25, 0.5, 0.75, 1];

// Puntos de las cinco opciones de un criterio, como arreglo [p1..p5]
const puntosDe = (c) => [c.p1, c.p2, c.p3, c.p4, c.p5].map((v) => Number(v) || 0);
const redondear = (n) => Math.round(n * 100) / 100;

module.exports = { ESCALA, REPARTO, puntosDe, redondear };
