# Auditoría del módulo de IRPF

**Fecha:** 2 de noviembre de 2026
**Alcance:** `src/sections/fiscal.js`, `src/utils/pdf.js`, `src/tests/irpf.test.js`

> No soy asesor fiscal. Todo lo que afirmo aquí está contrastado contra la
> Agencia Tributaria o el BOE, con la URL al lado. Lo que no he podido
> contrastar lleva **[VERIFICAR]** y no se presenta como cierto.

---

## 1. Qué modelaba la app antes

| Aspecto | Estado |
|---|---|
| Ejercicio | **Mezclado.** La escala del ahorro decía «2024» y era la de 2023-2024; la reducción por trabajo era la vigente desde 2024; se usaban para cualquier año seleccionado |
| Base del ahorro | Dividendos + ganancias − pérdidas, con el límite del 25 % del art. 49 |
| Base general | Salario bruto − SS − dietas − sindicatos − otros, menos la reducción del art. 20 |
| Mínimos personales y familiares | **Correctamente**: escala aplicada al mínimo y restada de la cuota (art. 63.1.2º), no restada de la base |
| Retenciones | Sí, del trabajo (`retencionEmpresa`) y de dividendos (19 %) |
| Comunidad autónoma | **No distingue.** Una sola escala general para todos |
| Territorios forales | **No se mencionaban** |
| Textos de la interfaz | Ya decían «orientativo» y «consulta a un asesor». No había ningún «cálculo exacto» ni «listo para presentar» |

**Lo que la app NO modela** (y ahora lo dice): arrastre de saldos negativos de
ejercicios anteriores, dividendos extranjeros con deducción por doble
imposición, rendimientos de actividades económicas, alquileres, planes de
pensiones, deducciones autonómicas, y tributación conjunta.

---

## 2. Errores encontrados

### 2.1 La escala del ahorro no cambiaba con el ejercicio · **CORREGIDO**

`src/sections/fiscal.js:13` tenía una constante única con el último tramo al
**28 %**, y se aplicaba a 2025 y 2026 igual que a 2024.

La **Ley 7/2024, de 20 de diciembre** modificó los arts. 66 y 76 LIRPF con
efectos desde el 1 de enero de 2025 y subió ese tramo al **30 %**.
Verificado: [Ley 7/2024 (BOE-A-2024-26694)](https://www.boe.es/buscar/act.php?id=BOE-A-2024-26694)
y [novedades normativa 2024 (AEAT)](https://sede.agenciatributaria.gob.es/Sede/irpf/novedades-impuesto/novedades-normativa-2024.html).

Efecto del error: a una base del ahorro de 400.000 € le calculaba 99.880 €
en vez de 101.880 €. **2.000 € de menos.**

> **Nota sobre el encargo:** el enunciado decía que el código tenía el tramo
> 200.000–300.000 al **26 %**. No era así: ya estaba al 27 %, con un
> comentario correcto citando la Ley 31/2022. El error real era otro.

### 2.2 La condición de las 6.500 € de la reducción no se comprobaba · **CORREGIDO**

El art. 20 LIRPF exige, para tener derecho a la reducción, que no haya
**otras rentas distintas del trabajo superiores a 6.500 €** (excluidas las
exentas). `calcReduccionTrabajo` no lo comprobaba.

Efecto: a quien tuviera, por ejemplo, 20.000 € en dividendos le aplicaba una
reducción a la que no tiene derecho, y la base general salía **hasta 7.302 €
por debajo** de la real.

Verificado en el [Manual práctico de Renta 2025, fase 3ª del cap. 3](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c03-rendimientos-trabajo/rendimiento-neto-trabajo-integrar-base-imponible/fase-3-determinacion-rendimiento-neto-reducido.html).

### 2.3 El ejercicio no se veía en ningún sitio · **CORREGIDO**

Había un selector de año, pero ni la pantalla ni el PDF decían con qué
tablas se había calculado. Un PDF se guarda y se mira meses después.

### 2.4 La base general se presentaba como si fuera el impuesto · **CORREGIDO (con aviso)**

La tabla 19/24/30/37/45/47 **no es el impuesto de ninguna comunidad**. Ahora
hay un aviso visible que lo dice. Ver sección 4.

### 2.5 Un error MÍO durante la auditoría, que merece constar

Mi primera versión puso la reducción de 2024 en **6.498 €**, dando por hecho
que la subida a 7.302 € era de 2025. **Es falso**: el
[Real Decreto-ley 4/2024, de 26 de junio](https://sede.agenciatributaria.gob.es/Sede/irpf/novedades-impuesto/novedades-normativa-2024/principales-novedades-real-decreto-ley-junio.html)
la subió con efectos desde el **1 de enero de 2024**, así que los mismos
importes valen para los dos ejercicios. El comentario que ya había en el
código estaba bien y mi corrección estaba mal. Lo detecté al verificar.

---

## 3. Qué está verificado y qué no

### Verificado contra fuente oficial

| Regla | Fuente |
|---|---|
| Escala del ahorro 2025: 19/21/23/27/**30** | [Manual 2025 · gravamen estatal del ahorro](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c15-calculo-impuesto-determinacion-cuotas-integras/gravamen-base-liquidable-ahorro/gravamen-estatal.html) + [autonómico](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c15-calculo-impuesto-determinacion-cuotas-integras/gravamen-base-liquidable-ahorro/gravamen-autonomico.html) |
| Escala del ahorro 2024: último tramo al 28 % | Ley 7/2024 (el cambio tiene efectos 2025, luego 2024 es el anterior) |
| La escala del ahorro la fija la LEY, igual en todo el territorio común | Arts. 66.1 y 76 LIRPF: los dos tramos son 9,50/10,50/11,50/13,50/15,00 |
| Cuota del ahorro a 300.000 € = **71.880 €** | Publicado por la AEAT. Coincide exactamente con la aritmética de los tests |
| Escala estatal general: 9,50/12/15/18,50/22,50/24,50 | [Manual 2025 · gravamen estatal general](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c15-calculo-impuesto-determinacion-cuotas-integras/gravamen-base-liquidable-general/gravamen-estatal.html) |
| Cada comunidad aprueba su propia escala general | El Manual 2025 enlaza **16 escalas autonómicas distintas** |
| Reducción art. 20 (2024 y 2025): 7.302 / 14.852 / 17.673,52 / 19.747,50, coeficientes 1,75 y 1,14 | [Manual 2025 fase 3ª](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c03-rendimientos-trabajo/rendimiento-neto-trabajo-integrar-base-imponible/fase-3-determinacion-rendimiento-neto-reducido.html) + RDL 4/2024 |
| Condición de otras rentas ≤ 6.500 € | Misma fuente |
| El mínimo personal y familiar se aplica a la CUOTA, no a la base | Art. 63.1.2º, citado en el Manual 2025 |

### [VERIFICAR] — no contrastado

1. **La mitad autonómica de la escala general.** Restando la estatal de la
   tabla de la app sale 9,50/12/15/18,50/22,50/**22,50**: igual que la
   estatal salvo el último tramo. Es coherente y reconocible, pero **no he
   podido contrastar a qué comunidad corresponde** ni si es una escala
   complementaria por defecto del art. 65. (De paso: **no** es la estatal
   duplicada, como supuse al principio — eso daría 49 %, no 47 %.)
2. **Ejercicio 2026.** No existe Manual práctico de Renta 2026: la campaña no
   se ha abierto. Las tablas de 2026 son **las de 2025 reutilizadas** y así
   se declara en la interfaz. Si hubo cambios normativos para 2026, están mal.
3. **Mínimos personales y familiares.** Los importes del código (5.550 base,
   +1.150 a partir de 65 años, +1.400 a partir de 75, 3.000/9.000 por
   discapacidad) **no los he contrastado** con el Manual. El método sí es
   correcto; los importes no están verificados.
4. **La regla de los dos meses** (art. 33.5.f/g LIRPF). El código mira ±60
   días para cualquier valor. La ley distingue: **2 meses** para valores
   admitidos a negociación en mercados regulados y **1 año** para el resto.
   La app **no distingue**, y para fondos de inversión y ETFs no he podido
   verificar cuándo cuentan como cotizados a estos efectos.
5. **El arrastre a 4 años** de saldos negativos (arts. 48-50 LIRPF). La app
   **no lo modela en absoluto**: calcula cada ejercicio aislado. El límite
   del 25 % sí está implementado.
6. **Dividendos extranjeros.** La app aplica el 19 % de retención española a
   todos. Un dividendo de EE. UU. lleva retención en origen (15 % con
   convenio) y da derecho a deducción por doble imposición: **la app no lo
   modela**, y el resultado para una cartera internacional será incorrecto.
7. **`dietas` se resta del bruto.** Las dietas exentas no forman parte del
   rendimiento íntegro computable, así que restarlas de un bruto que ya las
   excluye las descontaría dos veces. Depende de qué introduzca el usuario en
   ese campo y **no lo he cambiado** por no alterar el significado de un dato
   ya guardado.

---

## 4. Comunidades y regímenes NO soportados

### Territorios forales: no aplican la escala estatal

| Territorio | Norma propia |
|---|---|
| **País Vasco** (Álava, Bizkaia, Gipuzkoa) | Una Norma Foral por diputación |
| **Navarra** | Ley Foral del IRPF |

Para estos la estimación de la base general **no vale en absoluto**. La app
lo dice.

### Régimen común: escala autonómica no verificada en ninguna

**Ninguna** de las 15 comunidades de régimen común tiene su escala verificada
en la aplicación. La base general es una estimación con la escala de
referencia para todas:

Andalucía · Aragón · Asturias · Baleares · Canarias · Cantabria ·
Castilla-La Mancha · Castilla y León · Cataluña · Extremadura · Galicia ·
La Rioja · Madrid · Murcia · Comunidad Valenciana

Y **Ceuta y Melilla**, con su propio régimen de deducciones (50 % de la cuota
en determinados supuestos), que la app no modela.

**Por qué no se han implementado:** son 15 escalas, cada una en su boletín
oficial, que cambian cada ejercicio. Verificarlas y mantenerlas es un trabajo
que no se puede hacer a medias: una escala mal copiada da un número confiado
y equivocado, que es peor que no dar número. Se ha elegido la opción (b) del
encargo — estimación con aviso visible.

---

## 5. Qué debe revisar un asesor fiscal antes del lanzamiento

Por orden de riesgo:

1. **Los importes de los mínimos personales y familiares.** Es el punto 3 de
   la lista [VERIFICAR] y el que más afecta al resultado de un usuario normal.
2. **La regla antiaplicación de pérdidas**: que la distinción 2 meses / 1 año
   esté bien aplicada, y qué pasa con fondos y ETFs.
3. **El tratamiento de dividendos extranjeros.** Hoy se calculan como
   nacionales. Para cualquier cartera con acciones de EE. UU. o Europa el
   resultado es incorrecto, y es el caso más común entre quienes usarían esto.
4. **Si la escala general de referencia es aceptable** como estimación o si
   conviene no mostrar número en absoluto hasta tener las 15 escalas.
5. **El campo `dietas`**: qué se espera que introduzca el usuario y si
   restarlo del bruto es correcto.
6. **Los textos de los avisos**: si son suficientes desde el punto de vista
   de responsabilidad.

---

## 6. Lo que no pude comprobar

- **Nada contra Renta WEB.** No he ejecutado ni un caso en la herramienta
  oficial, que es la única comparación que de verdad valida el módulo
  completo. Lo que he verificado son las **tablas y las reglas**, una por
  una, contra el Manual y el BOE.
- **Los importes de los mínimos** y **la escala autonómica**, ya dicho.
- **El ejercicio 2026**, que no tiene Manual publicado.
- **La aritmética de los tests** es toda comprobable a mano y está escrita en
  comentarios, pero el único ancla externa es la cuota de 71.880 € a 300.000 €
  que publica la AEAT. Las demás acumuladas son mi propia suma de tramos.
- **El render de la pantalla de Fiscalidad y el PDF no se han visto.** No hay
  navegador en este entorno: el aviso nuevo está escrito y cableado, y los
  tests pasan, pero nadie lo ha mirado.
