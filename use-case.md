Sí. Como todavía no tenés el agente, lo que conviene hacer ahora es **construir manualmente el dataset en Slack** como si fueras el técnico de campo.

No necesitás medir nada real. La idea es que prepares mensajes, fotos y documentos técnicamente plausibles para después conectar el agente sobre ese historial.

Para que los números tengan respaldo real, usaría este setup de referencia:

- **Módulo:** JA Solar JAM72S30-550/MR. El datasheet oficial declara 550 W, Voc 49,90 V, Isc 14,00 A, coeficiente de Voc −0,275 %/°C y coeficiente de Isc +0,045 %/°C. 
- **String:** 18 módulos en serie.
- **Instrumento:** Fluke SMFT-1000 + IRR2-BT. El manual soporta polaridad, Voc, Isc, continuidad de tierra y aislamiento, además de transferir irradiancia y temperatura desde el medidor. 
- **Inversor:** Sungrow SG125CX-P2, un inversor string de 125 kW y hasta 1100 Vdc de entrada. 

## 0. Primero armá el canal

Creá un canal:

```text
#commissioning-inv-03
```

Fijá un primer mensaje:

> **Bloque en comisionamiento: INV-03**
>
> Inversor: Sungrow SG125CX-P2  
> Strings de prueba: STR-03-01 y STR-03-02  
> Módulo: JA Solar JAM72S30-550/MR  
> Cantidad: 18 módulos/string  
> Instrumento: Fluke SMFT-1000 + IRR2-BT
>
> Checklist:
> 1. Inspección visual: resultado + fotos
> 2. Tierra: resistencia + instrumento
> 3. Polaridad: resultado por string
> 4. Voc: voltaje + irradiancia + temperatura módulo + instrumento
> 5. Isc: corriente + irradiancia + temperatura módulo + instrumento
> 6. Aislamiento: resistencia + tensión de prueba + condición
> 7. Inversor: foto legible de placa

Con eso Slack ya parece un canal operativo real.

---

# Caso 1 — Voc incompleto: falta irradiancia

Este es el caso principal.

En Slack escribí exactamente algo natural:

> STR-03-01 Voc 842 V, temperatura módulo 47 °C. Medido con SMFT-1000.

No escribas irradiancia.

### Qué estás simulando

El técnico hizo el ensayo, pero al reportarlo olvidó uno de los campos.

Eso es especialmente creíble porque el Fluke puede mostrar Voc y también trabajar con el medidor de irradiancia; el problema no tiene por qué ser que la medición no existió, sino que **el técnico no la dejó registrada en Slack**. El manual indica que Voc/Isc puede medirse y que, cuando el medidor de irradiancia está conectado, se muestran irradiancia y temperatura de célula. 

### Qué debería detectar después el agente

```text
Voc          ✓
Temperatura  ✓
Instrumento ✓
Irradiancia ✗
```

---

# Caso 2 — Voc completo

Después, en otro momento o usando el otro string:

> STR-03-02 Voc 844 V, irradiancia 940 W/m², temperatura módulo 47 °C, SMFT-1000.

Este mensaje tiene todo.

El valor es razonable para 18 módulos JA Solar de ese modelo. A STC, cada módulo tiene Voc 49,90 V; la temperatura reduce Voc, así que alrededor de 840–845 V para un string de 18 módulos caliente es coherente con el datasheet. 

### Resultado futuro

El agente debería procesar y:

```text
✅
```

sin publicar advertencia.

---

# Caso 3 — Isc incompleto: falta temperatura

Escribí:

> STR-03-01 Isc 13,2 A, irradiancia 940 W/m², SMFT-1000.

No agregues temperatura.

El datasheet del módulo declara **Isc = 14,00 A en STC**, y una corriente alrededor de 13,2–13,3 A con irradiancia en torno a 940 W/m² es técnicamente plausible. 

### Lo que faltaría

```text
Isc          ✓
Irradiancia ✓
Instrumento ✓
Temperatura ✗
```

---

# Caso 4 — Medición completa pero con irradiancia demasiado baja

Escribí:

> STR-03-02 Voc 839 V, irradiancia 620 W/m², temperatura módulo 46 °C, SMFT-1000.

Todos los datos están presentes.

Pero el dataset de prueba define:

```text
irradiancia mínima = 700 W/m²
```

Entonces no es un problema de campos faltantes.

Es:

```text
registro completo
+
condición de ensayo inválida
```

Esto es útil porque demuestra que el motor no solo verifica existencia.

Para la narrativa técnica, tratá el umbral de 700 W/m² como **condición definida por el protocolo de demo**, no como si fuera universalmente exigida por IEC 62446-1 para cualquier lectura de Voc.

---

# Caso 5 — Placa del inversor incorrecta

En el canal primero fijá cuál es el equipo esperado:

> **Equipo programado para INV-03**  
> Modelo: Sungrow SG125CX-P2  
> Serial esperado: `A240903024`

Ese serial puede ser ficticio.

Después prepará una imagen de placa de prueba con:

```text
Modelo:
SG125CX-P2

Serial:
A240903042
```

Solo cambian:

```text
24
→
42
```

Subí la imagen con:

> Placa INV-03

### Qué debe ocurrir después

El sistema compara:

```text
esperado: A240903024
observado: A240903042
```

y detecta mismatch.

Usá el **modelo real**, pero seriales ficticios. El SG125CX-P2 es un modelo real de Sungrow; su ficha oficial indica 125 kW, 12 MPPT y entrada PV máxima de 1100 V. 

---

# Caso 6 — Placa correcta

Prepará una segunda imagen idéntica, pero esta vez:

```text
Serial:
A240903024
```

Subila:

> Placa INV-03, segunda verificación.

Resultado futuro:

```text
serial esperado = serial observado
→ ✅
→ silencio
```

---

# Caso 7 — Foto ilegible

Tomá la imagen de placa anterior y hacé una versión:

- desenfocada;
- oscura;
- cortada justo sobre el serial;
- o con reflejo fuerte.

Subila con:

> Placa INV-03

No escribas el serial en texto.

El caso que querés provocar es:

```text
modelo ve foto
→ no puede extraer serial
→ no inventa
```

Resultado futuro:

> No pude verificar el número de serie de esta imagen. Necesito una fotografía más legible.

Este caso es muy fuerte en demo.

---

# Caso 8 — El técnico escribe en ráfaga

Este es probablemente el caso más realista.

Mandá tres mensajes distintos.

### Mensaje 1

> STR-03-01 Voc 843 V

Esperá unos 5–10 segundos.

### Mensaje 2

> Temp módulo 47 °C

Esperá nuevamente.

### Mensaje 3

> Irradiancia 940 W/m², SMFT-1000

Ahora el historial real de Slack queda así:

```text
Técnico
STR-03-01 Voc 843 V

Técnico
Temp módulo 47 °C

Técnico
Irradiancia 940 W/m², SMFT-1000
```

El agente deberá juntar:

```text
843 V
47 °C
940 W/m²
SMFT-1000
```

y entender que es **un solo ensayo**.

El manual Fluke justamente trata Voc/Isc, irradiancia y temperatura como información relacionada de una misma prueba. 

---

# Caso 9 — Completado tardío

Este caso preparalo aunque probablemente no llegue a la primera versión.

Primero escribí:

> STR-03-02 Voc 841 V, temperatura módulo 46 °C, SMFT-1000.

Esperá bastante, por ejemplo 2 minutos.

Después:

> Irradiancia 925 W/m²

Ese segundo mensaje es interesante porque:

- no dice string;
- no dice Voc;
- solo completa el registro anterior.

El historial debería quedar exactamente así para probar asociación contextual.

```text
12:00
STR-03-02 Voc 841 V, temperatura módulo 46 °C, SMFT-1000

12:02
Irradiancia 925 W/m²
```

Cuando el agente exista:

```text
primero → hallazgo
después → completar mismo record
→ cerrar hallazgo
```

---

# También cargaría datos de los otros cuatro pasos

Aunque no entren en el video, te sirven para que el protocolo de siete pasos sea creíble.

## Inspección visual

Subí 2–3 fotos ficticias/no sensibles de:

- módulos;
- conectores;
- etiquetas;
- cableado.

Mensaje:

> STR-03-01 inspección visual OK. Sin daños visibles. Etiquetas y conectores verificados.

---

## Continuidad de tierra

Mensaje de prueba:

> Continuidad de tierra INV-03: 0,36 Ω, instrumento SMFT-1000.

El SMFT-1000 tiene una función específica de medición de resistencia del conductor de protección `RLO`; el manual describe conexiones de puesta a tierra y equipotencialidad. 

Para el dataset puede ser un número sintético plausible. No presentes ese valor como una medición real si no fue realmente medido.

---

## Polaridad

Mensaje:

> STR-03-01 polaridad correcta, positivo y negativo verificados.

Otro caso negativo opcional:

> STR-03-02 polaridad invertida.

El manual del SMFT-1000 incluye una prueba específica de polaridad y advertencia de polaridad incorrecta. 

---

## Aislamiento

Podés preparar:

> STR-03-01 aislamiento 18,4 MΩ, tensión de ensayo 1000 V CC, condición seca, SMFT-1000.

El Fluke permite seleccionar tensiones nominales de ensayo de **50, 100, 250, 500 o 1000 V** para la prueba de aislamiento. 

No fijaría todavía en el dataset público un criterio normativo definitivo de aprobación sin la revisión del ingeniero.

---

# Cómo dejaría el canal listo hoy

Al final deberías tener algo parecido a:

```text
#commissioning-inv-03

📌 Contexto del bloque + checklist

📎 JA Solar datasheet
📎 Fluke SMFT-1000 manual
📎 Sungrow SG125CX-P2 datasheet

[Técnico]
STR-03-01 Voc 842 V, temperatura módulo 47 °C, SMFT-1000

[Técnico]
STR-03-02 Voc 844 V, irradiancia 940 W/m²,
temperatura módulo 47 °C, SMFT-1000

[Técnico]
STR-03-01 Isc 13,2 A, irradiancia 940 W/m², SMFT-1000

[Técnico]
STR-03-02 Voc 839 V, irradiancia 620 W/m²,
temperatura módulo 46 °C, SMFT-1000

[Técnico]
📷 placa serial incorrecto

[Técnico]
📷 placa correcta

[Técnico]
📷 placa ilegible

[Técnico]
STR-03-01 Voc 843 V
[Técnico]
Temp módulo 47 °C
[Técnico]
Irradiancia 940 W/m², SMFT-1000

[Técnico]
STR-03-02 Voc 841 V, temperatura módulo 46 °C, SMFT-1000
...
[Técnico]
Irradiancia 925 W/m²
```

Con eso ya tenés **el dataset de Slack listo antes de escribir una línea del agente**.

## PDFs técnicos que usaría

**1. Fluke SMFT-1000 — Manual de uso en español**  
Es probablemente el documento más útil para justificar el flujo de ensayos. Incluye continuidad, polaridad, Voc/Isc, aislamiento e irradiancia/temperatura.   
[Abrir PDF oficial del Fluke SMFT-1000](https://media.fluke.com/8e60a963-00c9-4717-87d5-b10800c2fdc0_original%20file.pdf?utm_source=chatgpt.com)

**2. JA Solar JAM72S30 530–555/MR — Datasheet oficial**  
Incluye el módulo de 550 W y los valores eléctricos que estamos usando: Voc 49,90 V e Isc 14,00 A.   
[Abrir datasheet oficial JA Solar JAM72S30/MR](https://www.jasolar.com/uploadfile/fujian/2024/0807/4c15774add70e33.pdf?utm_source=chatgpt.com)

**3. Sungrow SG125CX-P2 — Datasheet oficial**  
Modelo real para el caso de placa/inversor.   
[Abrir datasheet oficial Sungrow SG125CX-P2](https://en.sungrowpower.com/upload/file/20220414/SG125CX-P2.pdf?utm_source=chatgpt.com)

**4. IEC 62446-1 — ficha oficial de la norma**  
La norma cubre documentación, inspección y ensayos de commissioning de sistemas FV conectados a red. El texto completo es comercial, así que no hay un PDF oficial gratuito completo para pasarte.   
[Ver IEC 62446-1:2016+A1:2018 en IEC](https://webstore.iec.ch/en/publication/63726?utm_source=chatgpt.com)

Un detalle importante: el manual Fluke vincula explícitamente la medición de **Voc a IEC 62446-1 §6.4** y **Isc a §6.5.2**, lo cual hace que el dataset sea bastante defendible para el hackathon sin tener que inventar el procedimiento. 

Si querés, el siguiente paso que haría es darte **20 mensajes exactos para copiar/pegar en Slack, en orden cronológico**, incluyendo timestamps simulados, quién los escribe y qué archivo/foto adjuntar en cada uno.