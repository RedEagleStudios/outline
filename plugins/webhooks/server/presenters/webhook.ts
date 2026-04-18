import type { WebhookDelivery } from "@server/models";
import type { Event } from "@server/types";

export interface WebhookPayload {
  model: Record<string, unknown> | null;
  id: string;
  /**
   * A summary of content changes in this event. Present only for document
   * events when the subscriber has opted in. Populated in Wave C (diff
   * enrichment); declared here so the type is available to all webhook
   * plumbing in Wave A.
   */
  changes?: {
    added: string[];
    removed: string[];
  };
  [key: string]: unknown;
}

interface WebhookProps {
  event: Event;
  delivery: WebhookDelivery;
  payload: WebhookPayload;
}

export interface WebhookPresentation {
  id: string;
  actorId: string;
  webhookSubscriptionId: string;
  event: string;
  payload: WebhookPayload;
  createdAt: Date;
}

export default function presentWebhook({
  event,
  delivery,
  payload,
}: WebhookProps): WebhookPresentation {
  return {
    id: delivery.id,
    actorId: event.actorId,
    webhookSubscriptionId: delivery.webhookSubscriptionId,
    createdAt: delivery.createdAt,
    event: event.name,
    payload,
  };
}
