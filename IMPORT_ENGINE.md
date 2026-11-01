# Motor universal de importación financiera

Estado: **capas 1 y 2 construidas y probadas. Capas 3 a 5 y la interfaz, no.**
Este documento dice exactamente qué funciona hoy, qué no, y por qué está
partido así.

- Capa 1 — formatos: [src/utils/import-formats.js](src/utils/import-formats.js)
- Capa 2 — semántica: [src/utils/import-semantic.js](src/utils/import-semantic.js)
- Tests: [src/tests/import-engine.test.js](src/tests/import-engine.test.js) — 81 casos

---

## Lo que ya existía en Finova antes de esto

Importa saberlo, porque cambia qué había que construir. **No faltaba un
importador: faltaba el motor que va encima de los que ya hay.**

| Vía existente | Formatos | Qué hace |
|---|---|---|
| Extracto → Transacciones | CSV, TXT, XLS, XLSX, XLSM, ODS, OFX, QFX, OFC | Detección de codificación, búsqueda de la fila de cabecera, reglas por banco español, extracción de comercio, clasificación con IA, dedupe por FITID y por firma, modal de revisión con estados |
| Cartera → Portfolio | CSV, TSV, TXT, Excel, JSON, XML, HTML | Detección de formato por contenido, alias de columnas, clase de activo, divisa, plan de fusión |

SheetJS ya se carga desde CDN bajo demanda (`_XLSX_CDN`), y jsPDF también.

---

## Capa 1 — Formatos

Convierte cualquier archivo en una representación única, el **IR**, para que
las capas de arriba no sepan nada de formatos.

### Formatos nuevos que antes no se leían

| Formato | Estado | Lo delicado |
|---|---|---|
| **QIF** | ✅ | El formato de fecha **no está declarado**: la misma cadena vale para MM/DD/YY y DD/MM/YY |
| **MT940** | ✅ | El signo es la letra `D`/`C` de la línea `:61:`; `RD`/`RC` lo invierten |
| **CAMT.053** | ✅ | El importe **siempre es positivo**; el signo lo da `<CdtDbtInd>` |
| **JSON** (como fuente bancaria) | ✅ | Los arrays casi nunca están en la raíz |
| **XML** (sin DOMParser) | ✅ | Prefijos de espacio de nombres distintos en cada exportación |
| **TSV** | ✅ | |
| **PDF** | ❌ **No construido** | Ver más abajo |

Y los que ya se leían (CSV, OFX/QFX, HTML, Excel) pasan ahora por un parseo
más estricto: comillas escapadas (`""`), saltos de línea **dentro** de un
campo, y separador elegido por consistencia entre líneas en vez de por
recuento bruto.

### Las dos clases de IR, y por qué

```
kind: 'tablas'     → CSV, TSV, JSON, XML, HTML, Excel
kind: 'registros'  → OFX, QIF, MT940, CAMT.053
```

Un CSV no dice qué significan sus columnas: hay que deducirlo, y de eso se
encarga la capa 2. **OFX, QIF, MT940 y CAMT.053 sí lo dicen**: son formatos
estandarizados donde `CdtDbtInd` es el signo y punto. Pasarlos por un
detector de columnas sería tirar información cierta y sustituirla por una
deducción, así que producen registros ya semánticos.

### Decisiones que merecen explicación

**El formato se decide por contenido, no por extensión.** Los bancos y los
brókers mienten con la extensión constantemente: lo más habitual es un
archivo llamado `.xls` que en realidad es una tabla HTML (Degiro, ING y
varios bancos lo hacen), o un `.csv` separado por tabuladores. La extensión
solo desempata, y **solo si el contenido es mínimamente tabular**: fiarse de
un `.csv` vacío hacía que el error saliera después y mucho peor («no se
encontraron transacciones» en vez de «no se reconoce el formato»).

**El orden del olfateo importa porque las firmas se contienen.** Un CAMT.053
es XML válido, y un OFX v2 también. Se mira de la firma más inequívoca a la
más ambigua.

**En JSON se buscan los arrays a cualquier profundidad, y todos.** Casi
ninguna exportación real pone el array arriba: vienen como
`{data:{transactions:[…]}}`, y muchas traen varios hermanos (posiciones y
operaciones en el mismo archivo). Quedarse con el primero perdería la mitad.
Los objetos anidados se aplanan a `padre.hijo`, porque sin eso la columna del
importe de una comisión (`{fee:{cost}}`) simplemente no existe.

**El XML se lee con un escáner de etiquetas propio, no con DOMParser.** Dos
razones: DOMParser no existe fuera del navegador, así que con él esto no se
podría probar; y los prefijos de espacio de nombres cambian en cada
exportación y aquí se ignoran a propósito.

**La fecha de apunte de MT940 viene sin año.** Heredar el de la fecha valor
sin más coloca un apunte del 31 de diciembre doce meses en el futuro cuando
el extracto es de principios de enero. Se corrige el salto de año.

**Un apunte de CAMT sin `<CdtDbtInd>` se omite.** Su signo no se puede
deducir de nada, y elegirlo sería meter un dato falso. Se cuenta y se
explica.

**El QIF ambiguo se avisa.** Si ninguna fecha del archivo tiene el primer
número mayor que 12, el orden día/mes no está demostrado: se asume el europeo
y se avisa, en vez de decidir en silencio.

**La categoría que trae un QIF es del programa de origen, no de Finova.**
Viaja como `categoriaOrigen`, una pista, y será la capa de clasificación la
que decida si la usa.

**`UNIQUEIDTYPE` de OFX dice si el identificador es un ISIN o un CUSIP.**
Meter un CUSIP en el campo ISIN sería un dato falso que después nadie podría
distinguir: va a `otroId`, etiquetado.

---

## Capa 2 — Semántica

Decide **qué significa cada columna** sin depender de que se llame de una
forma concreta. Es la parte que el encargo señalaba como la más importante.

### Las dos evidencias

Cada candidatura (columna × campo) se puntúa con dos cosas independientes:

1. **La cabecera.** «Fecha operación», «Trade Date» y «Data operació»
   apuntan al mismo campo. Coincidencia exacta, por fragmento, o por
   cobertura de palabras en cualquier orden.
2. **El contenido.** Una columna de fechas contiene fechas; una de ISIN
   contiene códigos que **pasan su dígito de control**; una de divisas
   contiene códigos ISO de tres letras.

**Ninguna basta sola.** Una cabecera «Importe» sobre una columna de texto no
es un importe, y una columna de números sin cabecera reconocible podría ser
cualquier cosa. Se exige que las dos apunten igual, y donde no lo hacen se
baja la confianza o **no se asigna**.

### Los 26 campos que reconoce

Fechas: `fechaOperacion`, `fechaValor`, `fechaContable`, `fechaLiquidacion`,
`fechaPago` · Texto: `descripcion`, `contrapartida`, `nombreActivo`,
`tipoOperacion`, `categoriaOrigen`, `tipoActivo` · Códigos: `isin`, `ticker`,
`idOperacion`, `cuenta`, `cuentaDestino`, `divisa` · Importes: `importe`,
`cargo`, `abono`, `saldo`, `comision`, `impuestos` · Cantidades y precios:
`cantidad`, `precioUnitario`, `precioMedio`, `precioActual` · Valoración:
`valorMercado`, `costeAdquisicion`, `gananciaPerdida`, `rentabilidadPct` ·
Otros: `dividendoPorAccion`, `tipoCambio`.

Cada uno declara `exactos`, `contiene`, **`excluye`** y un validador.

### `excluye` es lo que evita las confusiones que el encargo prohíbe

Sin reglas de exclusión, «Precio medio de compra» contiene «precio» exacto
igual que «Precio actual», y las dos columnas de precio de una cartera **se
intercambian**. Lo mismo con «Valor de mercado» y «Coste de adquisición».
Cada confusión que el encargo enumera tiene su regla y su test:

| Prohibido confundir | Cómo se evita |
|---|---|
| Valor de mercado ↔ coste de adquisición | `valorMercado` excluye `coste/cost/adquisicion/book`; `costeAdquisicion` excluye `mercado/market/actual` |
| Precio de compra ↔ precio actual | `precioMedio` excluye `actual/current/mercado/cierre`; `precioActual` excluye `medio/average/compra/coste` |
| Cantidad de títulos ↔ importe monetario | `cantidad` excluye `importe/amount/precio/valor/coste`; `importe` excluye `cantidad/quantity/units/titulos/shares` |
| Rentabilidad realizada ↔ no realizada | `gananciaPerdida` y `rentabilidadPct` son campos distintos; la de porcentaje excluye la absoluta |

### La asignación es global, no columna a columna

Se puntúan **todos** los pares (columna, campo) y se adjudican de mayor a
menor, con la regla de que una columna recibe un solo campo y un campo una
sola columna.

Decidir columna a columna produce el error clásico: la primera columna de
fecha se queda con `fechaOperacion` aunque se llame «Fecha valor», porque es
la primera que se mira. Hay un test con las tres fechas en orden engañoso a
propósito — la de operación es la **tercera** columna.

### El ISIN con dígito de control

Es la validación más valiosa del motor. Letras a su posición (A=10…Z=35),
concatenar, y Luhn. Un ISIN correcto es evidencia **casi definitiva**, y
permite reconocer la columna de ISIN aunque se llame «Ref», sin depender de
la cabecera. Hay test de que `US0378331006` (un dígito cambiado) se rechaza.

### Cuándo se niega a asignar

- **La cabecera dice una cosa y el contenido otra** → no se asigna. Una
  columna «Importe» de puro texto queda sin asignar y se informa.
- **Dos columnas de fecha con cabecera irreconocible** → ninguna se asigna.
  El tipo «fecha» es discriminante, pero el **papel** no lo es: elegir cuál
  es la de operación sería adivinar. Con **una** sola sí se asigna, con
  confianza media y el motivo explícito «es la única columna de fechas».
- **Columna vacía con cabecera clara** → entra con confianza **baja** y el
  motivo «la columna está vacía: no hay contenido que lo confirme».
- **Sin coincidencia de cabecera** → solo se asigna si el tipo es
  autosuficiente (ISIN, IBAN). Un número no lo es: la mitad de las columnas
  de un extracto son números.

Todo campo sale con `confianza` (`alta`/`media`/`baja`) y con los **motivos
en texto** que la sostienen, para que la interfaz pueda enseñarlos y el
usuario pueda auditar la decisión. Y existe `sinAsignar`, con una nota de lo
que contiene cada columna no interpretada: es información, no un fallo.

### La fila de cabecera

Muchos extractos ponen varias filas de título y metadatos antes («Consulta de
movimientos», «Cuenta: ES59…»). Se elige la fila con más cabeceras
reconocibles, descartando las que son mayoritariamente números o fechas (esas
son datos). Si ninguna destaca se devuelve **−1**, que significa «esta tabla
no tiene cabecera», y no 0, que significaría tratar la primera fila de datos
como cabecera y **perderla**.

---

## Lo que NO está construido

Esto es la mitad del encargo. Lo digo con precisión porque la parte hecha es
la base de la que dependen todas las demás, y es fácil confundir «la base
está» con «está hecho».

### Capa 3 — Tipo de documento (secciones 2 y 9 del encargo)

Decidir qué **es** un archivo: extracto bancario, fotografía de posiciones,
histórico de operaciones, informe de dividendos, movimientos de cripto,
informe fiscal, pasivos. Hoy el usuario tiene que elegir el botón correcto.

Incluye la distinción que el encargo subraya: **una fotografía de posiciones
actuales no es un histórico de compras.** Interpretar un archivo de
posiciones como si cada línea fuera una compra nueva duplicaría la cartera
entera. La señal está disponible (presencia de `valorMercado` y
`precioActual` sin `fechaOperacion` ni `tipoOperacion` → es un snapshot),
pero la lógica no está escrita.

### Capa 4 — Enrutado a secciones (sección 4)

Mapear cada registro a la colección real de `APP`. La correspondencia, ya
verificada contra la arquitectura:

| Dato | Destino real en Finova |
|---|---|
| Gastos e ingresos bancarios | `APP.transactions` |
| Acciones, ETFs, fondos | `APP.portfolio` |
| Dividendos | `APP.dividends` |
| Ventas (para fiscalidad) | `APP.sales` |
| Cripto | `APP.portfolio` (no hay sección propia) |
| Staking | `APP.stakingPositions` / `APP.stakingHistory` |
| Deudas | `APP.liabilities` |
| Saldos de cuenta | `APP.cashAccounts` |
| Patrimonio | `APP.networthHistory` |

### Capa 5 — Duplicados entre fuentes (sección 9)

Hoy el dedupe existe **solo dentro de `APP.transactions`** (por FITID y por
firma de contenido). Falta el caso que el encargo describe: la misma
transferencia apareciendo en un extracto bancario **y** en el archivo de
movimientos del bróker. Eso necesita una firma que cruce colecciones.

### Secciones 5, 6, 7 y 8 aplicadas

La capa 2 **reconoce los campos** de carteras, extractos y cripto, y hay
tests de los tres. Lo que falta es construir los objetos de destino con
ellos, más:

- **Cripto (sección 7):** detectar transferencias entre wallets propias para
  no contabilizarlas como ingreso o gasto. Requiere saber qué direcciones son
  del usuario, un dato que Finova hoy no guarda.
- **Categorización que aprende (sección 8):** ya existe `APP.categoryPatterns`
  (palabra clave → categoría) y se usa en la importación bancaria. Habría que
  extenderlo a establecimiento, tipo de activo y sector.

### PDF (sección 1)

No está construido, y tiene dos mitades muy distintas:

- **PDF con capa de texto:** se puede hacer con pdf.js, que está en la lista
  blanca de CDN del proyecto. Es trabajo acotado: extraer el texto y
  reconstruir las columnas por posición horizontal.
- **PDF escaneado:** necesita OCR. Finova **no puede hacerlo sin la clave de
  IA del usuario**, igual que el escáner de tickets. No hay OCR local, y no
  voy a activar ningún servicio de pago.

---

## Lo que no se ha podido verificar

No hay navegador en este entorno. Las dos capas están probadas con **81 tests
automáticos** sobre archivos de los nueve formatos, pero **ninguna interfaz
las usa todavía**, así que no hay nada que mirar a ojo. El riesgo real de
esta entrega no es que las capas fallen: es que son infraestructura sin
consumidor hasta que se escriban las capas 3 a 5.

Y los archivos de prueba los he escrito yo siguiendo las especificaciones de
cada formato. **No se han probado contra exportaciones reales** de ningún
banco, bróker o exchange concreto. Para MT940 y CAMT.053, donde cada entidad
usa los campos opcionales a su manera, eso importa: conviene probar con un
extracto de verdad antes de dar la compatibilidad por buena.
