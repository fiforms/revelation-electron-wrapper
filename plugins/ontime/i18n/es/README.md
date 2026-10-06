# Plugin de Integración con OnTime

Obtiene datos en vivo de un servidor de orden de servicio [OnTime](https://www.getontime.no/) para controlar temporizadores de cuenta regresiva y superposiciones dinámicas de tercio inferior en las diapositivas.

## Configuración inicial

En la configuración del plugin, establece **Poll URL** con el endpoint de la API de OnTime:

| Ajuste     | Ejemplo                              | Descripción                        |
|------------|--------------------------------------|------------------------------------|
| `pollUrl`  | `http://192.168.1.10:4001/api/poll`  | Endpoint REST `/api/poll` de OnTime |

Las superposiciones de tercio inferior consultan esta URL cada `pollIntervalSeconds` (predeterminado 5, mínimo 1). Los elementos de cuenta regresiva siempre consultan con un temporizador fijo de 5 segundos.

| Ajuste                | Predeterminado | Descripción                              |
|-----------------------|---------|------------------------------------------|
| `pollIntervalSeconds` | `5`     | Intervalo de consulta del tercio inferior, en segundos |

---

## Temporizador de cuenta regresiva

Muestra una cuenta regresiva en vivo tomada del temporizador de OnTime, que se actualiza cada segundo.

```yaml
:ontime:
  type: countdown
  timer: current
```

---

### Campos

| Campo    | Requerido | Predeterminado | Descripción                                              |
|----------|----------|-----------|----------------------------------------------------------|
| `type`         | sí   | —         | Debe ser `countdown`                                     |
| `timer`        | no   | `current` | Clave del temporizador en el payload de OnTime (`current`, `clock`, etc.) |
| `displayOffset`| no   | `0`       | Segundos añadidos solo al texto mostrado; los disparadores lo ignoran (puede ser negativo) |
| `actions`      | no   | —         | Activa acciones en momentos específicos (ver más abajo)  |

La cuenta regresiva se renderiza como un elemento `<h2>` con la clase `countdown`. Muestra `--:--` mientras OnTime está detenido.

---

### Visualización del temporizador

- Cuenta regresiva fluida: avanza localmente cada segundo y se sincroniza con el servidor cada 5 s.
- Se ajusta al valor del servidor si la deriva local supera los 3 segundos.
- Muestra un signo `-` inicial cuando el temporizador pasa de cero (tiempo extra).
- Las horas solo se incluyen cuando el tiempo restante es ≥ 1 hora.

### Desfase de visualización

`displayOffset` suma una cantidad fija de segundos al temporizador reportado antes de
mostrarlo. Úsalo cuando una columna deba contar hacia atrás hasta un momento distinto del que
OnTime está siguiendo. Por ejemplo, OnTime cuenta hacia atrás hasta un preludio de 5 minutos, pero una
columna previa a la reunión debe contar hasta el inicio de la reunión (5 minutos = 300 s
después):

---

```yaml
:ontime:
  type: countdown
  timer: current
  displayOffset: 300
```

El desfase es **solo cosmético**: cambia el texto mostrado pero no el
temporizador sobre el que actúan los disparadores. Los umbrales de `actions` (`zero`, `atTime`) siempre se disparan
según el valor real reportado por OnTime, sin importar `displayOffset`. Así, una columna
que muestra `display +5:00` igualmente dispara `zero` cuando el temporizador real de OnTime llega
a cero (cuando la pantalla marca `5:00`).

---

### Dar estilo a la cuenta regresiva

La cuenta regresiva se renderiza como un elemento `<h2 class="countdown">` dentro del
`<section>` de su diapositiva. Para darle estilo, apunta a la clase `countdown`. Para cambiar el estilo del temporizador en
**una sola** diapositiva, etiqueta esa diapositiva con un atributo de datos personalizado y limita tu
CSS a ella.

Añade el atributo con un comentario de atributo de diapositiva de Reveal (observa los dos puntos después de
`.slide`):

---

```markdown
:ontime:
  type: countdown
  timer: current

<!-- .slide: data-is-countdown-1 -->
```

Carga CSS personalizado añadiendo una clave `stylesheet:` al front
matter de la presentación, apuntando a un archivo `.css` en la misma carpeta que la presentación:

```yaml
---
title: My Service
theme: revelation_dark.css
stylesheet: mystyle.css
---
```

---

Luego, en `mystyle.css`, selecciona el temporizador de esa diapositiva y colócalo en la
esquina inferior izquierda, pequeño y semitransparente:

```css
.reveal section[data-is-countdown-1] h2.countdown {
  position: absolute;
  left: 0.4em;
  bottom: 0.3em;
  margin: 0;
  font-size: 2rem;   /* scales with the slide */
  opacity: 0.4;
  z-index: 100; /* layers above other elements */
}
```

---

`position: absolute` coloca el temporizador relativo a la diapositiva, por lo que se escala y
se ajusta con bandas (letterbox) igual que el resto de la presentación. Quita la parte `section[...]` del
selector (solo `.reveal h2.countdown`) para cambiar el estilo de todas las cuentas regresivas de la presentación.

### Acciones

Usa `actions` para activar la navegación entre diapositivas en momentos clave. Cada clave de acción es un
**disparador** (cuándo se activa); su valor nombra un **efecto** (qué hacer).

---

```yaml
:ontime:
  type: countdown
  timer: current
  actions:
    zero: advance
```

---

#### Disparadores

| Disparador   | Valor                       | Se activa cuando…                                                  |
|--------------|-----------------------------|--------------------------------------------------------------------|
| `zero`       | nombre del efecto           | el temporizador pasa de cero en su cuenta regresiva                |
| `atTime`     | `{ time, action }`          | el temporizador llega a `time`, el valor mostrado en la cuenta regresiva (positivo = restante, negativo = tiempo extra) |
| `atInterval` | `{ interval, action }`      | cada `interval` segundos de ejecución mientras el temporizador corre |

---

`atTime` también puede ser una lista de entradas `{ time, action }` para activar varias acciones en
momentos distintos. Cada disparador se activa una vez por cruce y se rearma si el temporizador
vuelve a subir por encima de su umbral (p. ej., un reinicio). `atInterval` cuenta solo mientras el temporizador
está en marcha, así que pausar OnTime pausa el ciclo.

#### Efectos

| Efecto          | Comportamiento                                                                         |
|-----------------|----------------------------------------------------------------------------------------|
| `advance`       | Pasa a la siguiente diapositiva (igual que presionar la flecha abajo/adelante).        |
| `advanceColumn` | Pasa a la siguiente columna (la diapositiva de la derecha).                            |
| `advanceLoop`   | Como `advance`, pero en la última diapositiva de una columna regresa a la primera diapositiva de esa columna en lugar de pasar a la siguiente columna. |

---

#### Ejemplo: carrusel de anuncios en bucle con traspaso cronometrado

Coloca este bloque en **cada** diapositiva de la columna de anuncios. Las diapositivas cambian
cada 10 segundos; cuando faltan 30 segundos, el control salta a la siguiente columna (p. ej.,
un video de introducción que reproduce los últimos 30 segundos):

```yaml
:ontime:
  type: countdown
  timer: current
  actions:
    atInterval:
      interval: 10
      action: advanceLoop
    atTime:
      time: 30
      action: advanceColumn
```

---

## Tercios inferiores dinámicos

Rellena una superposición de tercio inferior (proporcionada por el plugin **Lower Thirds**) con texto en vivo de los datos de eventos de OnTime, actualizándose automáticamente a medida que avanza el orden del servicio.

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
  caption: $eventNow.title
```

---

Los valores de los campos pueden ser **rutas resueltas** (con prefijo `$`) o **cadenas literales** (texto simple).

- Las **rutas resueltas** (p. ej., `$eventNow.custom.Presenter`) se resuelven a `payload.eventNow.custom.Presenter` en la respuesta de la API.
- Las **cadenas literales** (p. ej., `Q&A Session`) se usan tal cual, sin ninguna consulta al payload.

---

### Campos

| Campo   | Requerido | Predeterminado | Descripción                                                  |
|---------|----------|------------|--------------------------------------------------------------|
| `type`  | sí       | —          | Debe ser `lowerthird`                                        |
| `name`  | no       | —          | `$path.to.field` para resolver, o texto simple para una cadena estática |
| `title` | no       | —          | `$path.to.field` para resolver, o texto simple para una cadena estática |
| `style` | no       | `colorful` | Nombre del tema de tercios inferiores (consulta la documentación del plugin Lower Thirds) |

Los campos con prefijo `$` se resuelven a partir del payload de OnTime. Los campos sin `$` se tratan como texto literal. Los campos resueltos que dan como resultado `null`, `undefined` o una ruta inexistente se vacían automáticamente cuando cambia el evento.

---

### Ejemplo: mezcla de valores resueltos y literales

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
  caption: Q&A Session
```

En este ejemplo:
- `name` y `title` se resuelven a partir de los datos de OnTime y se actualizan a medida que cambia el orden del servicio
- `caption` es siempre `Q&A Session`, sin importar los datos del evento

---

### Valores separados por punto y coma y `index`

Los campos personalizados de OnTime pueden contener varios valores separados por ` ; ` (p. ej., `"John Doe; Jane Smith"`). Usa el campo `index` para seleccionar una entrada y luego repite el bloque en otra diapositiva con un índice distinto para crear tercios inferiores separados para cada persona.

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
  index: 0
```

---

```yaml
:ontime:
  type: lowerthird
  name: $eventNow.custom.Presenter
  title: $eventNow.custom.PresenterTitle
  index: 1
```

Dado `Presenter = "John Doe; Jane Smith"` y `PresenterTitle = "Director; Associate Director"`:

| `index` | Nombre renderizado | Título renderizado    |
|---------|--------------------|-----------------------|
| `0`     | John Doe           | Director              |
| `1`     | Jane Smith         | Associate Director    |

Omite `index` para usar el valor completo del campo sin dividirlo.

---

### Requisitos

- El plugin **Lower Thirds** debe estar habilitado.
- Establece **Slide View Distance** en la configuración de la presentación con un valor mayor que el número total de diapositivas, para que Reveal.js precargue todas las diapositivas y las superposiciones se rendericen antes de mostrarse.
- La primera consulta se dispara dentro de los 5 segundos posteriores a la carga de la presentación; hay una breve ventana en la que los campos de la superposición están en blanco.
