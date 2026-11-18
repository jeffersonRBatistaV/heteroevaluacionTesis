// Escala de calificación de cada criterio: cinco opciones fijas, de la peor a la mejor.
// Los puntos de cada opción los define el admin en la rúbrica, criterio por criterio.
const ESCALA = ['Deficiente', 'Insuficiente', 'Regular', 'Bueno', 'Excelente'];
// Reparto sugerido al crear un criterio: porcentaje de su puntaje máximo (Excelente)
const REPARTO = [0.2, 0.4, 0.6, 0.8, 1];

// Puntos de las cinco opciones de un criterio, como arreglo [p1..p5]
const puntosDe = (c) => [c.p1, c.p2, c.p3, c.p4, c.p5].map((v) => Number(v) || 0);
const redondear = (n) => Math.round(n * 100) / 100;

module.exports = { ESCALA, REPARTO, puntosDe, redondear };
