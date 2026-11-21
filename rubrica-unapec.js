// Rúbrica para la evaluación de los trabajos finales de posgrado (UNAPEC, Maestría en Enseñanza de la
// Matemática en el Nivel Secundario). Es la rúbrica general por defecto.
// Cada criterio: peso (puntos de Excelente; los pesos suman 100) y un descriptor por nivel,
// en orden d[0] = No aceptable (0) … d[4] = Excelente (4). Los puntos de cada nivel son peso × nivel / 4.
const RUBRICA_UNAPEC = [
  {
    nombre: 'Planteamiento del problema, antecedentes y objetivos',
    descripcion: 'Capítulo I (parte 1).',
    peso: 10,
    d: [
      'No hay planteamiento del problema claro, ni antecedentes ni objetivos identificables, o carecen de coherencia interna.',
      'El problema tiene poca relevancia y limitada contribución al conocimiento; los antecedentes no guardan relación directa con el tema. Los objetivos son imprecisos.',
      'El problema es relevante pero su solución es predecible; los antecedentes son escasos o poco variados. Los objetivos presentan dificultades de redacción o de alineación con la sistematización del problema.',
      'El problema está bien planteado y es relevante, aunque los antecedentes presentan alguna limitación menor (poca actualidad o variedad). Los objetivos son claros pero con leve falta de coherencia entre el general y los específicos.',
      'El problema está claramente planteado, es relevante, tiene posibilidad de solución y se sustenta en antecedentes nacionales e internacionales pertinentes y actualizados. Los objetivos general y específicos son claros, precisos, medibles y coherentes con la formulación y sistematización del problema.',
    ],
  },
  {
    nombre: 'Justificación e hipótesis',
    descripcion: 'Capítulo I (parte 2).',
    peso: 5,
    d: [
      'No hay justificación identificable ni hipótesis pertinente (cuando la investigación lo requiere).',
      'La justificación es débil o incompleta, sin vínculo claro con la maestría. La hipótesis (si aplica) no guarda relación con las variables.',
      'La justificación es superficial o genérica, con vínculo débil con las líneas de la maestría. La hipótesis presenta dificultad de redacción o relación con las variables.',
      'La justificación es adecuada y vincula la investigación con la maestría, aunque algún aspecto (social, académico o práctico) podría desarrollarse más. La hipótesis es correcta con alguna imprecisión menor.',
      'La justificación argumenta con solidez la relevancia social, académica y práctica de la investigación, vinculándola claramente con las líneas de investigación de la maestría. La hipótesis (si aplica) se formula correctamente y guarda relación directa con las variables del estudio.',
    ],
  },
  {
    nombre: 'Revisión de la literatura',
    descripcion: 'Capítulo II. Marco teórico, conceptual y legal.',
    peso: 15,
    d: [
      'Carece de marco teórico pertinente o las fuentes utilizadas no corresponden al tema.',
      'El marco teórico es superficial, con fuentes escasas o poco confiables, y sin conexión clara con el problema planteado.',
      'El marco teórico cubre los conceptos básicos, pero las fuentes son limitadas o poco variadas, o falta relación directa con las variables del estudio.',
      'El marco teórico es sólido y con fuentes confiables, aunque la síntesis crítica o el estado del arte podrían profundizarse más.',
      'El marco teórico integra teorías, conceptos y antecedentes investigativos actualizados y pertinentes, con fuentes variadas, confiables y de bases de datos científicas. Se evidencia el estado del arte y una síntesis crítica que sustenta las variables del estudio.',
    ],
  },
  {
    nombre: 'Marco metodológico',
    descripcion: 'Capítulo III. Paradigma, enfoque, diseño, población/muestra, instrumentos, validez y confiabilidad.',
    peso: 20,
    d: [
      'No se establece metodología, o esta es totalmente inapropiada para la solución del problema.',
      'El enfoque o diseño no es adecuado para resolver el problema. La población/muestra o los instrumentos carecen de justificación o validación.',
      'Se identifican el enfoque y diseño, pero hay dificultad en la selección de la metodología, la muestra o los instrumentos utilizados.',
      'La metodología es adecuada para resolver el problema, aunque la descripción de la muestra o la validación de instrumentos presenta alguna imprecisión.',
      'Se define con claridad el paradigma, enfoque, diseño y tipo de investigación, coherentes entre sí. La población, muestra y técnica de muestreo están bien justificadas. Los instrumentos son adecuados y su validez y confiabilidad están debidamente sustentadas (juicio de expertos, prueba piloto, Alfa de Cronbach, etc.).',
    ],
  },
  {
    nombre: 'Resultados, análisis y discusión',
    descripcion: 'Capítulo IV.',
    peso: 25,
    d: [
      'No se presentan resultados de forma organizada ni se realiza análisis o discusión.',
      'La presentación de resultados es limitada y el análisis carece de objetividad o de relación con el marco teórico.',
      'Los resultados se presentan, pero el análisis tiene dificultad estableciendo relaciones entre variables o discutiendo los hallazgos frente al marco teórico.',
      'Los resultados están bien presentados y el análisis es objetivo, aunque la discusión con la literatura previa podría profundizarse.',
      'Los resultados se presentan de manera clara y sistemática (tablas/gráficos) en correspondencia con los objetivos. El análisis es objetivo, establece relaciones entre los datos, permite inferencias y se discute críticamente contrastando con el marco teórico.',
    ],
  },
  {
    nombre: 'Conclusiones y recomendaciones',
    descripcion: '',
    peso: 10,
    d: [
      'No hay correspondencia entre conclusiones y objetivos, ni recomendaciones pertinentes.',
      'Las conclusiones responden poco a los objetivos y las recomendaciones son genéricas o poco fundamentadas.',
      'Las conclusiones responden parcialmente a los objetivos o su sustentación en los datos es débil.',
      'Las conclusiones responden a los objetivos y se sustentan en los datos, con leves generalizaciones. Las recomendaciones son adecuadas.',
      'Las conclusiones responden directamente a cada objetivo específico, se sustentan en los datos y evitan generalizaciones infundadas. Las recomendaciones son pertinentes y se derivan claramente de los hallazgos.',
    ],
  },
  {
    nombre: 'Referencias y citación (APA 7)',
    descripcion: '',
    peso: 5,
    d: [
      'No se documentan las fuentes o no se utiliza el formato APA establecido.',
      'Existen fuentes citadas en el texto que no aparecen en la bibliografía (o viceversa), y el formato APA presenta múltiples errores.',
      'Las fuentes están documentadas, pero con dificultad en la aplicación consistente del formato APA 7.',
      'Las fuentes están correctamente documentadas en APA 7, con errores mínimos y aislados.',
      'Todas las fuentes citadas en el texto están documentadas en la bibliografía y viceversa, siguiendo estrictamente el formato APA 7.ª edición, sin errores.',
    ],
  },
  {
    nombre: 'Redacción y estilo académico',
    descripcion: '',
    peso: 5,
    d: [
      'Redacción difícil de entender, con gran número de errores.',
      'Dificultad para entender lo expuesto; entre 6 y 8 errores ortográficos o gramaticales.',
      'Redacción comprensible en general, aunque a veces se pierde la idea por la extensión de las oraciones; menos de 5 errores.',
      'Redacción clara con menos de 3 errores ortográficos o gramaticales.',
      'Redacción en tercera persona, vocabulario claro, extensión apropiada de las oraciones, sin errores ortográficos ni gramaticales.',
    ],
  },
  {
    nombre: 'Cumplimiento de normas de formato',
    descripcion: 'Guía UNAPEC: tipología de letra, márgenes, espaciado, numeración, tablas y figuras.',
    peso: 5,
    d: [
      'El documento no sigue el formato institucional establecido en la guía.',
      'El documento presenta múltiples incumplimientos del formato establecido en la guía.',
      'Cumple parcialmente los requisitos formales; se identifican varias desviaciones respecto a la guía.',
      'Cumple la mayoría de los requisitos formales, con desviaciones menores en uno o dos aspectos (p. ej. numeración o espaciado).',
      'El documento cumple totalmente los requisitos formales de la guía: encuadernado, papel, tipo y tamaño de letra, márgenes, espaciado, sangrías, numeración de páginas y presentación de tablas y figuras.',
    ],
  },
];

// Nombres de los criterios de la rúbrica de ejemplo anterior: si la general sigue siendo esa, se reemplaza
const NOMBRES_EJEMPLO = ['Planteamiento del problema', 'Justificación y objetivos', 'Metodología', 'Resultados y conclusiones', 'Comunicación'];

module.exports = { RUBRICA_UNAPEC, NOMBRES_EJEMPLO };
