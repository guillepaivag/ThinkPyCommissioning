import Database from "better-sqlite3";
import { z } from "zod";
import { readYaml } from "../utils/yaml.js";
import type { ObservedValues } from "../utils/types.js";

export type ChannelBinding = { channelId: string; blockId: string; protocolId: string; enabled: boolean };
export type Equipment = { id: string; blockId: string; type: string; manufacturer?: string; model?: string; serialExpected?: string };
export type StoredRecord = {
  id: string; channelId: string; blockId: string; targetId: string; stepId: string; status: "open" | "complete";
  observed: ObservedValues; lastObservationAt: string; evaluationDueAt: string; evaluationStatus: "open" | "pending_evaluation" | "evaluated";
  completionMessageTs?: string;
};
export type PendingAction = {
  id: string; recordId: string; findingType: string; finding: unknown; status: "pending" | "approved" | "rejected" | "resolved" | "expired";
  proposedMessage: string; slackMessageTs?: string; createdAt: string; approvedAt?: string; approvedBy?: string; resolvedAt?: string;
};

type RecordRow = {
  id: string; channel_id: string; block_id: string; target_id: string; step_id: string; status: string;
  observed_json: string; last_observation_at: string; evaluation_due_at: string;
  evaluation_status: StoredRecord["evaluationStatus"]; completion_message_ts?: string;
};

const plantSchema = z.object({
  blocks: z.array(z.object({
    id: z.string(), protocol_id: z.string(),
    inverter: z.object({ id: z.string(), manufacturer: z.string(), model: z.string(), serial_expected: z.string() }),
    strings: z.array(z.string())
  })),
  channel_bindings: z.array(z.object({ channel_id: z.string(), block_id: z.string(), protocol_id: z.string(), enabled: z.boolean() })).default([])
});

export class SqliteStore {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS equipment (
        id TEXT PRIMARY KEY, block_id TEXT NOT NULL, type TEXT NOT NULL,
        manufacturer TEXT, model TEXT, serial_expected TEXT
      );
      CREATE TABLE IF NOT EXISTS channel_bindings (
        channel_id TEXT PRIMARY KEY, block_id TEXT NOT NULL, protocol_id TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, block_id TEXT NOT NULL,
        target_id TEXT NOT NULL, step_id TEXT NOT NULL, status TEXT NOT NULL,
        observed_json TEXT NOT NULL, last_observation_at TEXT NOT NULL,
        evaluation_due_at TEXT NOT NULL, evaluation_status TEXT NOT NULL,
        completion_message_ts TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS records_open_channel_idx ON records(channel_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS records_due_idx ON records(evaluation_due_at, evaluation_status);
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), type TEXT NOT NULL,
        file_path TEXT, original_filename TEXT, mime_type TEXT, slack_url TEXT, sha256 TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_actions (
        id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), finding_type TEXT NOT NULL,
        finding_json TEXT NOT NULL, status TEXT NOT NULL, proposed_message TEXT NOT NULL,
        slack_message_ts TEXT, created_at TEXT NOT NULL, approved_at TEXT, approved_by TEXT, resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS pending_actions_record_idx ON pending_actions(record_id, status);
      CREATE TABLE IF NOT EXISTS processed_events (
        event_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_ts TEXT NOT NULL, processed_at TEXT NOT NULL
      );
    `);
  }

  seedFromFile(path: string): void {
    const plant = plantSchema.parse(readYaml(path));
    const equipment = this.db.prepare(`INSERT INTO equipment (id, block_id, type, manufacturer, model, serial_expected)
      VALUES (@id, @blockId, @type, @manufacturer, @model, @serialExpected)
      ON CONFLICT(id) DO UPDATE SET block_id=excluded.block_id, type=excluded.type, manufacturer=excluded.manufacturer, model=excluded.model, serial_expected=excluded.serial_expected`);
    const binding = this.db.prepare(`INSERT INTO channel_bindings (channel_id, block_id, protocol_id, enabled)
      VALUES (@channelId, @blockId, @protocolId, @enabled)
      ON CONFLICT(channel_id) DO UPDATE SET block_id=excluded.block_id, protocol_id=excluded.protocol_id, enabled=excluded.enabled`);
    const seed = this.db.transaction(() => {
      for (const block of plant.blocks) {
        equipment.run({ id: block.inverter.id, blockId: block.id, type: "inverter", manufacturer: block.inverter.manufacturer, model: block.inverter.model, serialExpected: block.inverter.serial_expected });
        for (const stringId of block.strings) equipment.run({ id: stringId, blockId: block.id, type: "string", manufacturer: null, model: null, serialExpected: null });
      }
      for (const item of plant.channel_bindings) binding.run({ channelId: item.channel_id, blockId: item.block_id, protocolId: item.protocol_id, enabled: item.enabled ? 1 : 0 });
    });
    seed();
  }

  getChannelBinding(channelId: string): ChannelBinding | undefined {
    const row = this.db.prepare("SELECT channel_id, block_id, protocol_id, enabled FROM channel_bindings WHERE channel_id = ?").get(channelId) as { channel_id: string; block_id: string; protocol_id: string; enabled: number } | undefined;
    return row && { channelId: row.channel_id, blockId: row.block_id, protocolId: row.protocol_id, enabled: row.enabled === 1 };
  }

  listChannelBindings(): ChannelBinding[] {
    return (this.db.prepare("SELECT channel_id, block_id, protocol_id, enabled FROM channel_bindings ORDER BY channel_id").all() as { channel_id: string; block_id: string; protocol_id: string; enabled: number }[])
      .map((row) => ({ channelId: row.channel_id, blockId: row.block_id, protocolId: row.protocol_id, enabled: row.enabled === 1 }));
  }

  getEquipment(id: string): Equipment | undefined {
    const row = this.db.prepare("SELECT id, block_id, type, manufacturer, model, serial_expected FROM equipment WHERE id = ?").get(id) as { id: string; block_id: string; type: string; manufacturer?: string; model?: string; serial_expected?: string } | undefined;
    return row && { id: row.id, blockId: row.block_id, type: row.type, manufacturer: row.manufacturer, model: row.model, serialExpected: row.serial_expected };
  }

  listEquipmentByBlock(blockId: string): Equipment[] {
    return (this.db.prepare("SELECT id, block_id, type, manufacturer, model, serial_expected FROM equipment WHERE block_id = ?").all(blockId) as { id: string; block_id: string; type: string; manufacturer?: string; model?: string; serial_expected?: string }[])
      .map((row) => ({ id: row.id, blockId: row.block_id, type: row.type, manufacturer: row.manufacturer, model: row.model, serialExpected: row.serial_expected }));
  }

  markEventProcessed(eventId: string, channelId: string, messageTs: string, now = new Date().toISOString()): boolean {
    return this.db.prepare("INSERT OR IGNORE INTO processed_events (event_id, channel_id, message_ts, processed_at) VALUES (?, ?, ?, ?)").run(eventId, channelId, messageTs, now).changes === 1;
  }

  createRecord(record: StoredRecord, now = new Date().toISOString()): void {
    this.db.prepare(`INSERT INTO records (id, channel_id, block_id, target_id, step_id, status, observed_json, last_observation_at, evaluation_due_at, evaluation_status, completion_message_ts, created_at, updated_at)
      VALUES (@id, @channelId, @blockId, @targetId, @stepId, @status, @observed, @lastObservationAt, @evaluationDueAt, @evaluationStatus, @completionMessageTs, @now, @now)`).run({ ...record, observed: JSON.stringify(record.observed), now });
  }

  getRecord(recordId: string): StoredRecord | undefined {
    const row = this.db.prepare("SELECT * FROM records WHERE id = ?").get(recordId) as RecordRow | undefined;
    return row && this.toRecord(row);
  }

  findOpenRecord(channelId: string, targetId: string, stepId: string): StoredRecord | undefined {
    const row = this.db.prepare("SELECT * FROM records WHERE channel_id = ? AND target_id = ? AND step_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1").get(channelId, targetId, stepId) as RecordRow | undefined;
    return row && this.toRecord(row);
  }

  listOpenRecords(channelId: string): StoredRecord[] {
    return (this.db.prepare("SELECT * FROM records WHERE channel_id = ? AND status = 'open' ORDER BY updated_at DESC").all(channelId) as RecordRow[]).map((row) => this.toRecord(row));
  }

  listOverdueRecords(now: string): StoredRecord[] {
    return (this.db.prepare("SELECT * FROM records WHERE evaluation_due_at <= ? AND evaluation_status != 'evaluated'").all(now) as RecordRow[]).map((row) => this.toRecord(row));
  }

  mergeObservation(recordId: string, values: ObservedValues, messageTs: string, dueAt: string, now = new Date().toISOString()): StoredRecord {
    const current = this.getRecord(recordId);
    if (!current) throw new Error(`Record not found: ${recordId}`);
    const observed = { ...current.observed, ...values };
    this.db.prepare(`UPDATE records SET observed_json = ?, last_observation_at = ?, evaluation_due_at = ?, evaluation_status = 'pending_evaluation', completion_message_ts = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(observed), now, dueAt, messageTs, now, recordId);
    return this.getRecord(recordId)!;
  }

  markRecordEvaluated(recordId: string): void {
    this.db.prepare("UPDATE records SET evaluation_status = 'evaluated', updated_at = ? WHERE id = ?").run(new Date().toISOString(), recordId);
  }

  markRecordComplete(recordId: string): void {
    this.db.prepare("UPDATE records SET status = 'complete', evaluation_status = 'evaluated', updated_at = ? WHERE id = ?").run(new Date().toISOString(), recordId);
  }

  addEvidence(input: { id: string; recordId: string; type: string; originalFilename?: string; mimeType?: string; slackUrl?: string; filePath?: string; sha256?: string }, now = new Date().toISOString()): void {
    this.db.prepare(`INSERT OR IGNORE INTO evidence (id, record_id, type, file_path, original_filename, mime_type, slack_url, sha256, created_at)
      VALUES (@id, @recordId, @type, @filePath, @originalFilename, @mimeType, @slackUrl, @sha256, @now)`)
      .run({ filePath: null, originalFilename: null, mimeType: null, slackUrl: null, sha256: null, ...input, now });
  }

  createPendingAction(action: PendingAction): void {
    this.db.prepare(`INSERT INTO pending_actions (id, record_id, finding_type, finding_json, status, proposed_message, slack_message_ts, created_at, approved_at, approved_by, resolved_at)
      VALUES (@id, @recordId, @findingType, @finding, @status, @proposedMessage, @slackMessageTs, @createdAt, @approvedAt, @approvedBy, @resolvedAt)`)
      .run({ ...action, finding: JSON.stringify(action.finding), slackMessageTs: action.slackMessageTs ?? null, approvedAt: action.approvedAt ?? null, approvedBy: action.approvedBy ?? null, resolvedAt: action.resolvedAt ?? null });
  }

  getPendingAction(id: string): PendingAction | undefined {
    const row = this.db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row && this.toPendingAction(row);
  }

  approvePendingAction(id: string, approvedBy: string, now = new Date().toISOString()): PendingAction | undefined {
    const result = this.db.prepare("UPDATE pending_actions SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ? AND status = 'pending'").run(now, approvedBy, id);
    return result.changes === 1 ? this.getPendingAction(id) : undefined;
  }

  rejectPendingAction(id: string): PendingAction | undefined {
    const result = this.db.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(id);
    return result.changes === 1 ? this.getPendingAction(id) : undefined;
  }

  resolveOpenActions(recordId: string, now = new Date().toISOString()): PendingAction[] {
    const actions = this.db.prepare("SELECT * FROM pending_actions WHERE record_id = ? AND status IN ('pending', 'approved')").all(recordId) as Record<string, unknown>[];
    this.db.prepare("UPDATE pending_actions SET status = 'resolved', resolved_at = ? WHERE record_id = ? AND status = 'pending'").run(now, recordId);
    this.db.prepare("UPDATE pending_actions SET resolved_at = ? WHERE record_id = ? AND status = 'approved'").run(now, recordId);
    return actions.map((row) => this.toPendingAction(row));
  }

  setPendingActionSlackMessage(id: string, slackMessageTs: string): void {
    this.db.prepare("UPDATE pending_actions SET slack_message_ts = ? WHERE id = ?").run(slackMessageTs, id);
  }

  findActiveAction(recordId: string, findingType: string): PendingAction | undefined {
    const row = this.db.prepare("SELECT * FROM pending_actions WHERE record_id = ? AND finding_type = ? AND status IN ('pending', 'approved') ORDER BY created_at DESC LIMIT 1").get(recordId, findingType) as Record<string, unknown> | undefined;
    return row && this.toPendingAction(row);
  }

  latestUnresolvedFinding(targetId: string, stepId: string, findingType: string): PendingAction | undefined {
    const row = this.db.prepare(`SELECT pa.* FROM pending_actions pa JOIN records r ON r.id = pa.record_id
      WHERE r.target_id = ? AND r.step_id = ? AND pa.finding_type = ? AND pa.status IN ('pending', 'approved') ORDER BY pa.created_at DESC LIMIT 1`).get(targetId, stepId, findingType) as Record<string, unknown> | undefined;
    return row && this.toPendingAction(row);
  }

  latestUnresolvedFindingAt(targetId: string, stepId: string, findingType: string): string | undefined {
    const row = this.db.prepare(`SELECT pa.created_at FROM pending_actions pa JOIN records r ON r.id = pa.record_id
      WHERE r.target_id = ? AND r.step_id = ? AND pa.finding_type = ? AND pa.status IN ('pending', 'approved') ORDER BY pa.created_at DESC LIMIT 1`).get(targetId, stepId, findingType) as { created_at?: string } | undefined;
    return row?.created_at;
  }

  private toRecord(row: RecordRow): StoredRecord {
    return {
      id: row.id, channelId: row.channel_id, blockId: row.block_id, targetId: row.target_id, stepId: row.step_id,
      status: row.status as StoredRecord["status"], observed: JSON.parse(row.observed_json) as ObservedValues,
      lastObservationAt: row.last_observation_at, evaluationDueAt: row.evaluation_due_at, evaluationStatus: row.evaluation_status,
      completionMessageTs: row.completion_message_ts
    };
  }

  private toPendingAction(row: Record<string, unknown>): PendingAction {
    return {
      id: String(row.id), recordId: String(row.record_id), findingType: String(row.finding_type), finding: JSON.parse(String(row.finding_json)),
      status: row.status as PendingAction["status"], proposedMessage: String(row.proposed_message), slackMessageTs: row.slack_message_ts ? String(row.slack_message_ts) : undefined,
      createdAt: String(row.created_at), approvedAt: row.approved_at ? String(row.approved_at) : undefined, approvedBy: row.approved_by ? String(row.approved_by) : undefined,
      resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined
    };
  }

  close(): void { this.db.close(); }
}
