/** Printful webhook payload (API v1). Only identifiers are trusted; status is re-fetched from the API. */
export interface PrintfulWebhookPayload {
  type: string;
  created: number;
  retries: number;
  store: number;
  data: { order?: { id: number; external_id: string | null } };
}

export function parsePrintfulWebhook(body: unknown): PrintfulWebhookPayload {
  const p = body as PrintfulWebhookPayload;
  if (!p || typeof p.type !== 'string' || typeof p.store !== 'number' || typeof p.created !== 'number') {
    throw new Error('Malformed Printful webhook payload');
  }
  return p;
}

/** Printful does not send a delivery ID; type + order + created timestamp identifies a delivery. */
export function printfulEventId(p: PrintfulWebhookPayload): string {
  return `${p.type}:${p.data.order?.id ?? 'none'}:${p.created}`;
}
