import type { NormalizedSignal } from "../utils/types.js";

export type SlackSignalPayload = {
  event_id: string;
  event: { channel: string; ts: string; user?: string; text?: string; files?: { id: string; mimetype?: string; url_private?: string; name?: string }[] };
};

export function normalizeSlackSignal(payload: SlackSignalPayload): NormalizedSignal {
  return {
    eventId: payload.event_id,
    channelId: payload.event.channel,
    messageTs: payload.event.ts,
    userId: payload.event.user,
    text: payload.event.text,
    files: payload.event.files?.map((file) => ({ id: file.id, mimeType: file.mimetype, url: file.url_private, name: file.name }))
  };
}
