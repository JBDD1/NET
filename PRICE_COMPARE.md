# Comparador universal de precios

Responde a una sola pregunta: **«de todo lo que he comprado o contratado,
¿dónde he pagado menos por lo mismo?»**.

No hay un comparador por sector. Hay un motor que mira **qué datos trae cada
línea** y decide con qué unidad se puede comparar. Un supermercado, una
gasolinera y una suscripción entran por la misma puerta y salen con métricas
distintas (`€/l`, `€/kg`, `€/mes`, `€/operación`) porque sus datos son
distintos, no porque haya tres códigos.

- Motor: [src/utils/price-compare.js](src/utils/price-compare.js) — sin
  interfaz, sin dependencias.
- Interfaz: bloque «Comparador de precios» de la ficha de una transacción,
  en [src/utils/tx-history.js](src/utils/tx-history.js).
- Tests: [src/tests/price-compare.test.js](src/tests/price-compare.test.js) —
  80 casos.

---

## La regla que gobierna todo el fichero

Antes de comparar dos precios hay que **poder afirmar** que son comparables.
Cada par de líneas se clasifica en cuatro niveles y **solo los dos primeros se
comparan en precio**:

| Nivel | Qué significa | ¿Se compara el precio? |
|---|---|---|
| `identico` | Mismo producto, misma marca, mismo tamaño | Sí |
| `equivalente` | Mismo producto y magnitud, otro tamaño o marca | Sí, por unidad canónica |
| `similar` | Comparten el término principal pero difieren en algo que cambia el precio | **No.** Se enseña aparte |
| `no-comparable` | Ni eso | No |

El cuarto nivel es lo que mantiene esto honesto. **Una comparación de menos es
una molestia; una comparación falsa es un número inventado que el usuario se
cree.** Todo lo que sigue sale de ese orden de prioridades.

Ejemplos reales de los tests:

```
Leche semidesnatada 1L / Leche semidesnatada 1 L        → identico
Leche semidesnatada 1L / Leche semidesnatada 500ml      → equivalente  (0,49/0,5 = 0,98 €/l)
Pack 12 cervezas 33cl  / Pack 6 cervezas 33cl           → identico     (el lote no cambia el producto)
Leche entera 1L        / Leche semidesnatada 1L         → similar      (no cuestan lo mismo)
iPhone 15 128GB        / iPhone 16 128GB                → similar
Nike Air 90            / Nike Air 95                    → similar
IdeaPad 15 16GB        / IdeaPad 15 8GB                 → similar
Leche semidesnatada    / Taladro percutor               → no-comparable
```

---

## Qué está implementado

### 1. Comparación de productos entre comercios

Para cada línea de un ticket escaneado: su precio por unidad canónica, el de
todos los comercios donde el usuario compró lo mismo, cuál es el más barato,
cuál el más caro, y la diferencia en valor absoluto y en porcentaje.

Se compara por el **último** precio de cada comercio, que es la pregunta real
(«¿dónde me costaría hoy menos, según lo que ya he pagado?»). La media, el
mínimo y el máximo históricos viajan en el mismo objeto y se usan en la serie.

### 2. Conversión de unidades

Todo se lleva a una unidad canónica por magnitud: `kg`, `l`, `m`, `ud`.
Comparar €/kg con €/g sin convertir daría una diferencia de 1000× y un ahorro
absurdo.

| Magnitud | Unidades que se reconocen | Canónica |
|---|---|---|
| Peso | kg, g, gr, mg | €/kg |
| Volumen | l, ml, cl | €/l |
| Longitud | m, cm | €/m |
| Unidad | ud | €/ud |

Una unidad que no esté en esa tabla (`oz`, por ejemplo) **no se convierte**:
la línea pasa a tratarse por unidad en vez de inventar un factor.

### 3. Combustible y otras magnitudes deducidas del nombre

En un ticket de gasolinera `qty` son litros y `unitPrice` es €/l, pero **nada
en los datos lo dice**. Lo delata el nombre (`gasolina`, `gasoil`, `diesel`,
`sin plomo`, `adblue`…).

Esto se deduce del **nombre del producto, nunca de la categoría**: «Transporte»
incluye gasolina (litros) y abonos de metro (viajes), y tratar la categoría
entera como litros produciría un €/l inventado. Hay un test que lo fija.

### 4. Servicios sin líneas de detalle

Cuando la operación no tiene ticket escaneado, lo único que hay es importe,
fecha, categoría y comercio. Con eso se compara el coste **por operación** o
**por periodo** frente a los otros proveedores de la misma categoría.

La periodicidad se **mide** con las fechas del propio historial, no se deduce
de la categoría: una suscripción se reconoce porque se repite cada ~30 días,
con una desviación menor del 25 % de la media. Si no hay patrón, se dice
`€/operación` en vez de fingir un coste mensual.

```
mensual     25–35 días    → €/mes
semanal      6–8 días     → €/semana
trimestral  80–100 días   → €/trimestre
anual      330–400 días   → €/año
```

**Si las cadencias están mezcladas, no se presenta un coste periódico.** Un
proveedor mensual de 12 € y otro anual de 120 € compararían 12 contra 120 como
si fuera lo mismo: cae a `€/operación` y cada proveedor conserva su propia
cadencia medida, para poder enseñarla.

Toda comparación de servicio lleva una **advertencia visible**: el importe es
real, pero Finova no guarda las condiciones de lo contratado (duración,
coberturas, qué incluye), así que la equivalencia **no está verificada**.

### 5. Ahorro histórico

```
diferencia por unidad × cantidad realmente comprada en esa línea
```

Verificado a mano: leche a 1,05 €/l en Carrefour frente a 0,89 €/l en
Mercadona, 6 botellas de 1 L → 0,16 × 6 = **0,96 €**. Y 12 botellas de 500 ml
dan el mismo resultado, porque son los mismos 6 litros.

**Nunca se presenta como oferta.** Cada cifra lleva la fecha y el comercio del
precio con el que se compara, y el texto lo dice: «es el precio que tú pagaste
allí el 05/08/2026, no una oferta de hoy». Si la compra actual fue la más
barata, no se inventa un ahorro: se dice que fue la más barata.

### 6. Procedencia de cada precio

Todo precio lleva de dónde sale, y la procedencia **viaja con el dato** en vez
de deducirse al pintar. Es la única forma de garantizar que un precio
histórico no se presente como actual.

| Fuente | Significa | ¿La produce algo hoy? |
|---|---|---|
| `linea-ticket` | Línea de un ticket escaneado | Sí |
| `importe-total` | Importe de la operación, sin desglose | Sí |
| `externa` | Precio verificado en una fuente externa | **No.** Reservada |
| `estimada` | Estimación | **No.** Reservada |

Las dos últimas están declaradas para que integrar una fuente externa no
obligue a tocar la interfaz: ya distingue y etiqueta.

### 7. Fiabilidad a la vista

Cada cifra dice **cuántos precios la sostienen**. Con uno solo pone «1 solo
precio», resaltado, porque una media de un dato no es una media. Sin esto el
usuario no puede valorar si la comparación le vale.

### 8. Evolución del precio de un producto

Serie temporal del precio por unidad canónica con el comercio de cada punto, y
la variación entre el primero y el último. Responde a «¿me está subiendo el
precio de esto?». Se dibuja con Chart.js al pulsar el botón de la línea
correspondiente; **si Chart.js no está, los mismos datos se enseñan en texto**.

### 9. Mayores diferencias de todo el historial

Los productos comprados en más de un sitio, ordenados por diferencia
porcentual entre el comercio más barato y el más caro. La vista de «dónde
estoy perdiendo dinero».

---

## Qué datos necesita

### Lo que se usa

Del propio modelo de transacción, sin añadir nada:

| Dato | Origen | Imprescindible |
|---|---|---|
| `amount`, `date`, `category` | Siempre está | Sí |
| Identidad del comercio | `mhMerchantKey` (descripción o `receipt.merchant`) | Sí: un precio sin comercio no responde a la pregunta |
| `receipt.items[].name` | Escáner de tickets | Para comparar por producto |
| `receipt.items[].unitPrice` o `total` + `qty` | Escáner | Para tener un precio |
| `receipt.items[].brand` | Escáner, **nuevo** | No, mejora la precisión |
| `receipt.items[].size` + `sizeUnit` | Escáner, **nuevo** | No, permite el nivel `equivalente` |

### Los tres campos nuevos del escáner

`brand`, `size` y `sizeUnit` se han añadido a
[src/utils/receipt-scan.js](src/utils/receipt-scan.js) con este comparador.
Consecuencias que conviene tener claras:

- **Los tickets escaneados antes de esta versión no los llevan.** El motor
  funciona igual sin ellos, con menos precisión: sin `size` cae al tamaño que
  venga escrito en el nombre («LECHE SEMI 1 L»), y si tampoco está, el
  producto se trata por unidad.
- Se piden con instrucciones explícitas de **preferir `null` a inventar**: un
  tamaño inventado produce una comparación falsa, que es peor que no tener
  comparación. Las unidades se validan contra una lista cerrada y cualquier
  otra se descarta.
- `size` es el contenido de **una** unidad, no del lote: en un pack de 6
  botellas de 33 cl, `size` es 33 y las 6 van en `qty`.

### Lo que NO hay, y el encargo mencionaba

**No existe en los datos, y no se inventa:**

- Código de barras, referencia, modelo, SKU
- Especificaciones técnicas
- Duración o condiciones de un servicio
- Noches de un hotel, régimen, categoría
- Coberturas o franquicias de un seguro
- Kilómetros, trayecto u origen/destino de un transporte
- Talla o temporada de una prenda

**No hay un importador de facturas aparte.** «Documentos importados» significa,
en Finova, el escáner de tickets y nada más.

Donde falta el dato, el motor **no compara: dice que no puede**. Por eso un
hotel se compara por importe por operación y con la advertencia a la vista, en
vez de por €/noche, que es lo que haría falta y no se puede calcular.

---

## Qué integraciones externas harían falta para ampliarlo

Nada de esto está contratado ni activado. Son las piezas que faltarían, con lo
que cada una resolvería y lo que costaría en esfuerzo.

### 1. Catálogo de productos por código de barras

**Qué resolvería:** el nivel `identico` dejaría de depender del texto del
nombre. Dos tickets que escriben el mismo producto de dos formas distintas se
reconocerían como el mismo.

**Qué haría falta:** que el ticket traiga el código (la mayoría de los tickets
españoles **no lo imprimen**), o escanear el código del producto aparte. Más
una base de datos de referencias — Open Food Facts es abierta para
alimentación; para el resto de sectores no hay una fuente abierta equivalente.

**Honestamente:** el cuello de botella es el ticket, no la base de datos. Sin
código en el ticket, una API de catálogo no aporta.

### 2. Precios de mercado actuales

**Qué resolvería:** la única limitación de fondo del comparador. Hoy todo lo
que dice es **histórico**: «pagaste menos allí», no «hoy cuesta menos allí».

**Qué haría falta:** un proveedor de precios por comercio y producto. Los
agregadores de supermercados españoles no publican una API abierta; el *scraping*
de sus webs es frágil y de legalidad discutible. Habría que evaluar
proveedores comerciales caso por caso.

**Ya está preparado:** la fuente `externa` existe en `PC_FUENTES` con
`verificado: true, actual: true`, y la interfaz distingue las fuentes al
pintar. Integrarla sería añadir descriptores con esa fuente al índice, sin
tocar la interfaz.

### 3. Lectura estructurada de facturas (no de tickets)

**Qué resolvería:** los sectores que hoy solo se pueden comparar por importe
total. Una factura de seguro trae la cobertura; una de hotel, las noches; una
de luz, los kWh. Con eso saldrían `€/noche`, `€/kWh` y comparaciones de
seguros de verdad.

**Qué haría falta:** aceptar PDF además de imagen, y un prompt por tipo de
documento. El escáner actual está hecho para tickets de compra.

### 4. Precio por unidad impreso en el ticket

**Qué resolvería:** muchos tickets españoles ya imprimen el €/kg o €/l en la
línea. Leerlo directamente evitaría depender de `size` × `unitPrice`.

**Qué haría falta:** un campo más en el escáner. **Es la mejora de mejor
relación coste/beneficio de esta lista** y no necesita ningún servicio externo.

---

## Lo que no se ha podido verificar

No hay navegador en este entorno. El bloque del comparador se ha **renderizado
de verdad** con un historial de seis sectores y se ha leído su HTML y su texto,
pero **nadie lo ha visto**. Quedan por comprobar a ojo:

- El gráfico de evolución con Chart.js cargado. El render se probó con `Chart`
  indefinido, así que la rama que se ha ejecutado es la de texto.
- Los 5 temas y el comportamiento a 375 px.
- Que los destinos táctiles lleguen a 44 px en un dispositivo real.

---

## Decisiones que merecen explicación

**El núcleo del nombre usa TODAS las palabras, sin recortar.** Recortarlo a las
primeras sobre-agrupaba: «IdeaPad 15 16GB» y «IdeaPad 15 8GB» daban el mismo
núcleo y se comparaban como si fueran el mismo portátil, perdiendo justo lo que
los distingue.

**Los números se conservan aunque tengan una o dos cifras**, al contrario que
las palabras cortas. Son discriminadores de modelo, versión o año. Con un
filtro de 3 caracteres, «iPhone 15 128GB» y «iPhone 16 128GB» daban el mismo
núcleo (`iphone 128gb`) y salían como **idénticos**. Lo mismo «Nike Air 90» y
«Nike Air 95».

**Hay un segundo índice por familia** (magnitud + primera palabra del núcleo).
Sin él el nivel `similar` era inalcanzable entre productos distintos, porque la
comparación solo miraba dentro del grupo del propio núcleo, donde por
definición todo comparte núcleo. El resultado era una lista de parecidos
**siempre vacía**: un campo que mentía por omisión.

**Una `qty` de 0 con un total positivo no produce precio.** El salto a «el
total es el precio de una unidad» está pensado para una `qty` **desconocida**
(`null`). Un 0 explícito contradice un total positivo, y de un dato
contradictorio no sale un precio, sale un invento. Lo encontró un test.

**Los decimales se deciden una vez por columna, no por valor.** Una columna que
mezclaba «0,890 €/l» y «1,05 €/l» hacía ilegible justo lo que la tabla existe
para comparar. Y los precios y las diferencias son **dos** columnas con
decisiones separadas: con una sola, una diferencia de 0,85 € forzaba tres
decimales sobre precios de 9,80 €.

**La tabla pinta el valor por el que de verdad se ordena.** Los productos se
ordenan por su último precio y los servicios por su importe medio. Pintar el
último mientras se ordena por el medio pondría la etiqueta «más barato» sobre
el número más alto de la columna.

**Los ingresos no entran en el índice.** Una devolución no es un precio pagado.

**Con un solo comercio no hay comparación**, y la diferencia es `null`, no 0:
un 0 % parecería un dato.

**El índice se memoiza y se invalida por importe, no solo por longitud.**
Editar un importe sin añadir transacciones también tiene que recalcular.

**Un solo canvas para la evolución, que se rellena al pulsar.** Montar un
Chart.js por producto serían media docena de gráficos que nadie va a mirar, y
el canvas de un bloque cerrado tiene altura 0.

---

## Rendimiento

El índice de **5.000 transacciones con ticket** (10.000 líneas) se construye en
menos de 200 ms y se memoiza: la segunda llamada es inmediata. Hay un test que
lo fija con un margen amplio.
