# Commissioning Agent

Agente de commissioning para técnicos de campo que trabajan en Slack. No es un chatbot ni requiere menciones: cada actividad de Slack se normaliza, se acumula en SQLite y solo desencadena una intervención cuando la validación determinista encuentra una diferencia con el protocolo aprobado.

## Agentic Pattern: Signal-Driven Agent Activation

Implementa [Signal-Driven Agent Activation](https://www.agentic-patterns.com/patterns/signal-driven-agent-activation/). La fuente de señal es la actividad de un canal Slack. El adaptador la normaliza inmediatamente; el binding del canal aporta bloque y protocolo; los campos observados se acumulan de forma persistente por `channel_id + target_id + step_id`. Al cerrar la ventana de evaluación, el validador compara el estado acumulado con el YAML de protocolo. Solo una diferencia activa el flujo: se crea una propuesta en español y queda detrás de aprobación humana.

In the canonical pattern, an incoming external signal often directly satisfies an activation threshold. In this implementation, incoming Slack activity updates observed work state. The activation condition is the deterministic difference between that accumulated observed state and the expected state defined by the commissioning protocol.

El LLM puede clasificar, extraer salida estructurada y redactar el mensaje; nunca detecta ausencia, aprueba acciones ni decide la activación. La ausencia y los rangos se calculan de manera determinista. El cooldown de 30 minutos se aplica únicamente a notificaciones repetidas del mismo hallazgo sin resolver. `channel_bindings.enabled` es el kill switch. `processed_events` deduplica `event_id`, y los registros, validaciones y acciones pendientes proporcionan el rastro de auditoría de cada activación.

Un caso completo recibe solo la reacción ✅ en el último mensaje técnico. Un caso incompleto publica bloques Slack con botones Aprobar/Rechazar, ligados al ID exacto de la acción. La evidencia tardía se combina con el mismo registro, resuelve el hallazgo y actualiza el mensaje publicado.

## Ejecutar la demo

```bash
npm install
npm run demo -- case1
npm run demo -- case5
npm run demo -- all
```

La última orden reproduce los nueve casos y debe terminar con `9 passed` y `0 failed`. Las señales, clasificaciones y extracciones del runner son fixtures sintéticos; el validador, SQLite, normalización y acumulación son las capas reales de producción. La integración Slack y los proveedores de modelos están implementados pero requieren credenciales reales.

## Configuración y despliegue

Copie `.env.example` a `.env`, complete todos los valores y ejecute `npm run build && npm start`. El ejemplo usa Groq con `openai/gpt-oss-120b`; configure `AI_PROVIDER=groq` y `GROQ_API_KEY`. OpenRouter y OpenAI siguen disponibles con `AI_PROVIDER=openrouter|openai` y sus respectivas claves. El arranque valida tokens Slack, modelos, proveedor, ruta SQLite y parámetros numéricos. `GET /health` responde con `{ "ok": true }`.

```bash
docker build -t commissioning-agent .
docker run --env-file .env -p 8080:8080 commissioning-agent
```

El despliegue de hackathon usa SQLite local en una única instancia de Cloud Run (`min instances = 1`, `max instances = 1`, facturación basada en instancia/CPU disponible). La base de datos **no es durable** ante reemplazo de instancia y esta arquitectura no está diseñada para persistencia de producción. Por eso el proceso ejecuta barrido periódico y recuperación de evaluaciones vencidas al arrancar, pero no sustituye almacenamiento durable.

Los documentos bajo `data/documents/` son solo material de referencia de ingeniería: el runtime no los lee, no los indexa ni los usa como RAG. Las decisiones deben revisarse y codificarse en el YAML de protocolo aprobado.

Trabajo futuro, no implementado: convertir Word/PDF en un borrador de protocolo, revisarlo por ingeniería y versionar el YAML aprobado.
