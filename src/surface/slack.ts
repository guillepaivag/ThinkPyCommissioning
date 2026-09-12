import { randomUUID } from "node:crypto";
import { App, LogLevel } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { SqliteStore } from "../domain/store.js";
import { normalizeSlackSignal, type SlackSignalPayload } from "../signals/normalize.js";
import type { NormalizedSignal } from "../utils/types.js";

export type SignalProcessor = (signal: NormalizedSignal) => Promise<{ recordId?: string; ignored?: string; stepName?: string; unreadableFields?: string[] }>;
type SlackClient = App["client"];

const PROCESSING_REACTION = "hourglass_flowing_sand";
const FAILED_REACTION = "x";

function log(entry: object): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
}

export function findingBlocks(actionId: string, message: string): KnownBlock[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `⚠️ ${message}` } },
    { type: "actions", elements: [
      { type: "button", action_id: "approve_finding", text: { type: "plain_text", text: "Aprobar" }, style: "primary", value: actionId },
      { type: "button", action_id: "reject_finding", text: { type: "plain_text", text: "Rechazar" }, style: "danger", value: actionId }
    ] }
  ];
}

export function resolvedBlocks(message: string): KnownBlock[] {
  return [{ type: "section", text: { type: "mrkdwn", text: `✅ Resuelto: ${message}` } }];
}

export function repeatedFindingText(action: { status: string; proposedMessage: string }): string {
  return `⚠️ Hallazgo ya registrado (${action.status === "approved" ? "aprobado" : "pendiente de aprobación"}): ${action.proposedMessage}`;
}

export function imageNotMatchingText(stepName?: string, unreadableFields?: string[]): string {
  return stepName
    ? `⚠️ La imagen no coincide con lo esperado para el ensayo "${stepName}": no se pudo leer ${unreadableFields?.length ? unreadableFields.join(", ") : "la información requerida"}. Enviá una nueva fotografía legible.`
    : "⚠️ La imagen no coincide con lo esperado: no corresponde a ningún ensayo del protocolo de este bloque.";
}

// Replies are threaded under the technician's message so they stay tied to the
// evidence that caused them, and broadcast so they remain visible in the channel.
export async function postThreadReply(client: SlackClient, channel: string, threadTs: string | undefined, text: string): Promise<void> {
  if (threadTs) await client.chat.postMessage({ channel, text, thread_ts: threadTs, reply_broadcast: true });
  else await client.chat.postMessage({ channel, text });
}

type TrackedMessage = { channel: string; ts: string; recordId?: string; deadline: number };

// Visible processing state for each technician message: an hourglass while the
// signal is being worked on, removed once an outcome is delivered, and replaced
// by an error mark when no outcome arrives in time. This is presentation state
// only; the commissioning state of record lives in SQLite.
export class ProcessingIndicator {
  private readonly tracked = new Map<string, TrackedMessage>();
  private readonly timedOut = new Map<string, TrackedMessage[]>();
  private sweep?: NodeJS.Timeout;

  constructor(private readonly client: SlackClient, private readonly timeoutMs: number) {}

  /** Starts tracking a message. Returns false when it was already being tracked. */
  async begin(channel: string, ts: string): Promise<boolean> {
    if (this.tracked.has(ts)) return false;
    this.tracked.set(ts, { channel, ts, deadline: Date.now() + this.timeoutMs });
    this.sweep ??= setInterval(() => void this.expire(), 5_000);
    this.sweep.unref();
    await this.react("add", channel, ts, PROCESSING_REACTION);
    return true;
  }

  /** Binds a message to the record it accumulated into; the record's messages share one deadline. */
  attach(ts: string, recordId: string): void {
    const message = this.tracked.get(ts);
    if (!message) return;
    message.recordId = recordId;
    const deadline = Date.now() + this.timeoutMs;
    for (const other of this.tracked.values()) if (other.recordId === recordId) other.deadline = deadline;
  }

  async finish(ts: string): Promise<void> {
    const message = this.tracked.get(ts);
    if (!message) return;
    this.tracked.delete(ts);
    await this.react("remove", message.channel, ts, PROCESSING_REACTION);
  }

  async fail(ts: string): Promise<void> {
    const message = this.tracked.get(ts);
    if (!message) return;
    this.tracked.delete(ts);
    await this.react("remove", message.channel, ts, PROCESSING_REACTION);
    await this.react("add", message.channel, ts, FAILED_REACTION);
  }

  async finishRecord(recordId: string): Promise<void> {
    for (const message of this.messagesOf(recordId)) await this.finish(message.ts);
    // An outcome that arrives after the deadline clears the error mark it caused.
    for (const message of this.timedOut.get(recordId) ?? []) await this.react("remove", message.channel, message.ts, FAILED_REACTION);
    this.timedOut.delete(recordId);
  }

  async failRecord(recordId: string): Promise<void> {
    for (const message of this.messagesOf(recordId)) await this.fail(message.ts);
  }

  async expire(now = Date.now()): Promise<void> {
    for (const message of [...this.tracked.values()]) {
      if (message.deadline > now) continue;
      if (message.recordId) this.timedOut.set(message.recordId, [...(this.timedOut.get(message.recordId) ?? []), message]);
      log({ level: "warn", event: "processing_timeout", channel: message.channel, ts: message.ts, recordId: message.recordId ?? null });
      await this.fail(message.ts);
    }
  }

  private messagesOf(recordId: string): TrackedMessage[] {
    return [...this.tracked.values()].filter((message) => message.recordId === recordId);
  }

  private async react(operation: "add" | "remove", channel: string, timestamp: string, name: string): Promise<void> {
    try {
      if (operation === "add") await this.client.reactions.add({ channel, timestamp, name });
      else await this.client.reactions.remove({ channel, timestamp, name });
    } catch (error) {
      const code = (error as { data?: { error?: string } }).data?.error;
      if (code !== "already_reacted" && code !== "no_reaction") log({ level: "error", event: "reaction_failed", operation, name, error: code ?? (error instanceof Error ? error.message : String(error)) });
    }
  }
}

// Slack serves uploaded files privately, so the bot token must be presented to
// download them. A failed download leaves the file without bytes, which the
// extractor then reports as absent evidence instead of a guessed value.
async function downloadFiles(files: NormalizedSignal["files"], token: string): Promise<NormalizedSignal["files"]> {
  if (!files?.length) return files;
  return Promise.all(files.map(async (file) => {
    if (!file.url || !file.mimeType?.startsWith("image/")) return file;
    try {
      const response = await fetch(file.url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
      log({ level: "info", event: "evidence_downloaded", fileId: file.id, mimeType: file.mimeType, bytes: base64.length });
      return { ...file, base64 };
    } catch (error) {
      log({ level: "error", event: "evidence_download_failed", fileId: file.id, error: error instanceof Error ? error.message : String(error) });
      return file;
    }
  }));
}

export function createSlackApp(input: { token: string; signingSecret: string; appToken?: string; store: SqliteStore; processSignal: SignalProcessor; processingTimeoutMs?: number }): App & { indicator: ProcessingIndicator } {
  const app = new App({ token: input.token, signingSecret: input.signingSecret, appToken: input.appToken, socketMode: Boolean(input.appToken), ...(process.env.SLACK_DEBUG ? { logLevel: LogLevel.DEBUG } : {}) });
  const indicator = new ProcessingIndicator(app.client, input.processingTimeoutMs ?? 120_000);
  app.event("message", async ({ body, event }) => {
    const slackEvent = event as { channel?: string; ts?: string; user?: string; text?: string; files?: { id: string; mimetype?: string; url_private?: string; name?: string }[]; subtype?: string };
    log({ level: "info", event: "slack_message_received", channel: slackEvent.channel, ts: slackEvent.ts, subtype: slackEvent.subtype ?? null, text: slackEvent.text?.slice(0, 120), files: slackEvent.files?.length ?? 0 });
    if ((slackEvent.subtype && slackEvent.subtype !== "file_share") || !slackEvent.channel || !slackEvent.ts) {
      log({ level: "info", event: "slack_message_skipped", reason: slackEvent.subtype ? `subtype:${slackEvent.subtype}` : "missing_channel_or_ts" });
      return;
    }
    const payload: SlackSignalPayload = { event_id: body.event_id, event: { channel: slackEvent.channel, ts: slackEvent.ts, user: slackEvent.user, text: slackEvent.text, files: slackEvent.files } };
    const normalized = normalizeSlackSignal(payload);
    const { channelId: channel, messageTs: ts } = normalized;
    const fresh = await indicator.begin(channel, ts);
    try {
      const signal: NormalizedSignal = { ...normalized, files: await downloadFiles(normalized.files, input.token) };
      const outcome = await input.processSignal(signal);
      log({ level: "info", event: "signal_processed", eventId: signal.eventId, recordId: outcome.recordId ?? null, ignored: outcome.ignored ?? null });
      if (outcome.recordId) {
        for (const file of signal.files ?? []) input.store.addEvidence({ id: randomUUID(), recordId: outcome.recordId, type: "slack_file", originalFilename: file.name, mimeType: file.mimeType, slackUrl: file.url });
        // The outcome arrives when the record is evaluated, after the window closes.
        indicator.attach(ts, outcome.recordId);
        return;
      }
      if (outcome.ignored === "duplicate") {
        // A redelivery of a message that is still in progress must not end its tracking.
        if (fresh) await indicator.finish(ts);
        return;
      }
      if (outcome.ignored === "image_not_matching") {
        await postThreadReply(app.client, channel, ts, imageNotMatchingText(outcome.stepName, outcome.unreadableFields));
        await indicator.finish(ts);
        return;
      }
      if (outcome.ignored === "evidence_unavailable") {
        await indicator.fail(ts);
        return;
      }
      await indicator.finish(ts);
    } catch (error) {
      log({ level: "error", event: "signal_processing_failed", eventId: normalized.eventId, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack?.split("\n")[1]?.trim() : undefined });
      await indicator.fail(ts);
    }
  });

  app.error(async (error) => {
    log({ level: "error", event: "bolt_error", error: error instanceof Error ? error.message : String(error) });
  });
  app.action("approve_finding", async ({ ack, body, client }) => {
    await ack();
    const interactive = body as unknown as { actions: { value?: string }[]; channel?: { id?: string }; container: { message_ts?: string } };
    const actionId = interactive.actions[0]?.value;
    const approved = actionId && input.store.approvePendingAction(actionId, body.user.id);
    if (!approved) return;
    const channel = interactive.channel?.id;
    const messageTs = interactive.container.message_ts;
    if (channel && messageTs) await client.chat.update({ channel, ts: messageTs, text: `✅ Aprobado: ${approved.proposedMessage}`, blocks: [{ type: "section", text: { type: "mrkdwn", text: `✅ Aprobado: ${approved.proposedMessage}` } }] });
  });
  app.action("reject_finding", async ({ ack, body, client }) => {
    await ack();
    const interactive = body as unknown as { actions: { value?: string }[]; channel?: { id?: string }; container: { message_ts?: string } };
    const actionId = interactive.actions[0]?.value;
    const rejected = actionId && input.store.rejectPendingAction(actionId);
    if (!rejected) return;
    const channel = interactive.channel?.id;
    const messageTs = interactive.container.message_ts;
    if (channel && messageTs) await client.chat.update({ channel, ts: messageTs, text: `⏭️ Rechazado: ${rejected.proposedMessage}`, blocks: [{ type: "section", text: { type: "mrkdwn", text: `⏭️ Rechazado: ${rejected.proposedMessage}` } }] });
  });
  return Object.assign(app, { indicator });
}
