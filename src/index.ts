import { join } from "node:path";
import { loadConfig } from "./config.js";
import { SqliteStore } from "./domain/store.js";
import { createSlackApp } from "./surface/slack.js";
import type { CommissioningService } from "./app.js";
import type { NormalizedSignal } from "./utils/types.js";

const config = loadConfig();
const store = new SqliteStore(config.sqlitePath);
store.initialize();
store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));

// The Slack socket handshake is established first, with only the store and the
// surface loaded. The scheduler, the service and the health server are wired in
// afterwards: loading them ahead of the handshake stalls it.
let service: CommissioningService | undefined;
const app = createSlackApp({
  token: config.slackBotToken, signingSecret: config.slackSigningSecret, appToken: config.slackAppToken, store,
  processSignal: (signal: NormalizedSignal) => service ? service.ingest(signal) : Promise.resolve({ ignored: "starting" }),
  // A technician message without an outcome after two minutes is marked as failed.
  // The deadline never falls inside a normal evaluation window.
  processingTimeoutMs: Math.max(120, config.evaluationDelaySeconds + 30) * 1_000
});
await app.start();
console.log(JSON.stringify({ level: "info", event: "slack_connected" }));

const { CommissioningService: Service } = await import("./app.js");
const { EvaluationScheduler } = await import("./signals/scheduler.js");
const { proposeFinding } = await import("./agent/propose.js");
const { findingBlocks, resolvedBlocks, postThreadReply, repeatedFindingText } = await import("./surface/slack.js");
const { createServer } = await import("node:http");

const scheduler = new EvaluationScheduler({
  store, cooldownMinutes: config.findingCooldownMinutes,
  proposal: proposeFinding,
  effects: {
    onComplete: async (record) => { if (record.completionMessageTs) await app.client.reactions.add({ channel: record.channelId, timestamp: record.completionMessageTs, name: "white_check_mark" }); },
    onFinding: async (record, action) => (await app.client.chat.postMessage({ channel: record.channelId, text: `⚠️ ${action.proposedMessage}`, blocks: findingBlocks(action.id, action.proposedMessage) })).ts,
    onResolved: async (record, action) => { if (action.slackMessageTs) await app.client.chat.update({ channel: record.channelId, ts: action.slackMessageTs, text: `✅ Resuelto: ${action.proposedMessage}`, blocks: resolvedBlocks(action.proposedMessage) }); },
    onRepeated: async (record, action) => { await postThreadReply(app.client, record.channelId, record.completionMessageTs, repeatedFindingText(action)); }
  },
  logger: (entry) => console.log(JSON.stringify(entry)),
  onEvaluated: async (recordId) => { await app.indicator.finishRecord(recordId); },
  onEvaluationFailed: async (recordId) => { await app.indicator.failRecord(recordId); }
});
service = new Service({ store, scheduler, delaySeconds: config.evaluationDelaySeconds });
scheduler.start();

createServer((request, response) => {
  if (request.url === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: true })); return; }
  response.writeHead(404); response.end();
}).listen(config.port);
console.log(JSON.stringify({ level: "info", event: "commissioning_agent_started", port: config.port }));
