import fetchMock from "jest-fetch-mock";
import { Document, Revision, WebhookDelivery } from "@server/models";
import {
  buildDocument,
  buildUser,
  buildWebhookDelivery,
  buildWebhookSubscription,
} from "@server/test/factories";
import type { DocumentEvent, UserEvent } from "@server/types";
import DeliverWebhookTask from "./DeliverWebhookTask";

beforeEach(async () => {
  jest.resetAllMocks();
  fetchMock.resetMocks();
  fetchMock.doMock();
});

const ip = "127.0.0.1";

describe("DeliverWebhookTask", () => {
  test("should hit the subscription url and record a delivery", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["*"],
    });
    const signedInUser = await buildUser({ teamId: subscription.teamId });
    const processor = new DeliverWebhookTask();

    fetchMock.mockResponse("SUCCESS", { status: 200 });

    const event: UserEvent = {
      name: "users.signin",
      userId: signedInUser.id,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };
    await processor.perform({
      subscriptionId: subscription.id,
      event,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.com",
      expect.anything()
    );
    const parsedBody = JSON.parse(
      fetchMock.mock.calls[0]![1]!.body!.toString()
    );
    expect(parsedBody.webhookSubscriptionId).toBe(subscription.id);
    expect(parsedBody.event).toBe("users.signin");
    expect(parsedBody.payload.id).toBe(signedInUser.id);
    expect(parsedBody.payload.model).toBeDefined();

    const deliveries = await WebhookDelivery.findAll({
      where: { webhookSubscriptionId: subscription.id },
    });
    expect(deliveries.length).toBe(1);

    const delivery = deliveries[0];
    expect(delivery.status).toBe("success");
    expect(delivery.statusCode).toBe(200);
    expect(delivery.responseBody).toEqual("SUCCESS");
  });

  test("should hit the subscription url with signature header", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["*"],
      secret: "secret",
    });
    const signedInUser = await buildUser({ teamId: subscription.teamId });
    const processor = new DeliverWebhookTask();

    const event: UserEvent = {
      name: "users.signin",
      userId: signedInUser.id,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };
    await processor.perform({
      subscriptionId: subscription.id,
      event,
    });

    const headers = fetchMock.mock.calls[0]![1]!.headers! as Record<
      string,
      string
    >;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headers["Outline-Signature"]).toMatch(/^t=[0-9]+,s=[a-z0-9]+$/);
  });

  test("should hit the subscription url when the eventing model doesn't exist", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["*"],
    });
    const deletedUserId = crypto.randomUUID();
    const signedInUser = await buildUser({ teamId: subscription.teamId });

    const task = new DeliverWebhookTask();
    const event: UserEvent = {
      name: "users.delete",
      userId: deletedUserId,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };

    await task.perform({
      event,
      subscriptionId: subscription.id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.com",
      expect.anything()
    );
    const parsedBody = JSON.parse(
      fetchMock.mock.calls[0]![1]!.body!.toString()
    );
    expect(parsedBody.webhookSubscriptionId).toBe(subscription.id);
    expect(parsedBody.event).toBe("users.delete");
    expect(parsedBody.payload.id).toBe(deletedUserId);

    const deliveries = await WebhookDelivery.findAll({
      where: { webhookSubscriptionId: subscription.id },
    });
    expect(deliveries.length).toBe(1);

    const delivery = deliveries[0];
    expect(delivery.status).toBe("success");
    expect(delivery.statusCode).toBe(200);
    expect(delivery.responseBody).toBeDefined();
  });

  test("should mark delivery as failed if post fails", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["*"],
    });

    fetchMock.mockResponse("FAILED", { status: 500 });

    const signedInUser = await buildUser({ teamId: subscription.teamId });
    const task = new DeliverWebhookTask();

    const event: UserEvent = {
      name: "users.signin",
      userId: signedInUser.id,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };

    await task.perform({
      event,
      subscriptionId: subscription.id,
    });

    await subscription.reload();

    expect(subscription.enabled).toBe(true);

    const deliveries = await WebhookDelivery.findAll({
      where: { webhookSubscriptionId: subscription.id },
    });
    expect(deliveries.length).toBe(1);

    const delivery = deliveries[0];
    expect(delivery.status).toBe("failed");
    expect(delivery.statusCode).toBe(500);
    expect(delivery.responseBody).toBeDefined();
    expect(delivery.responseBody).toEqual("FAILED");
  });

  test("should disable the subscription if past deliveries failed", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["*"],
    });
    for (let i = 0; i < 25; i++) {
      await buildWebhookDelivery({
        webhookSubscriptionId: subscription.id,
        status: "failed",
      });
    }

    fetchMock.mockResponse(JSON.stringify({ message: "Failure" }), {
      status: 500,
    });

    const signedInUser = await buildUser({ teamId: subscription.teamId });
    const task = new DeliverWebhookTask();

    const event: UserEvent = {
      name: "users.signin",
      userId: signedInUser.id,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };

    await task.perform({
      event,
      subscriptionId: subscription.id,
    });

    await subscription.reload();

    expect(subscription.enabled).toBe(false);

    const deliveries = await WebhookDelivery.findAll({
      where: { webhookSubscriptionId: subscription.id },
      order: [["createdAt", "DESC"]],
    });
    expect(deliveries.length).toBe(26);

    const delivery = deliveries[0];
    expect(delivery.status).toBe("failed");
    expect(delivery.statusCode).toBe(500);
    expect(delivery.responseBody).toEqual('{"message":"Failure"}');
  });

  describe("document changes diff", () => {
    test("includes changes in payload when includeChanges is true and previous revision exists", async () => {
      fetchMock.mockResponse("SUCCESS", { status: 200 });

      const subscription = await buildWebhookSubscription({
        url: "http://example.com",
        events: ["documents.update"],
        includeChanges: true,
      });

      const document = await buildDocument({ teamId: subscription.teamId });

      // Create the "previous" revision with known text
      await Revision.create({
        documentId: document.id,
        userId: document.createdById,
        title: document.title,
        text: "old line one\nold line two\n",
        createdAt: new Date(Date.now() - 2000),
      });

      // Update document text to simulate a new version
      await Document.update(
        { text: "old line one\nnew line three\n" },
        { where: { id: document.id } }
      );
      await document.reload();

      // Create a second (latest) revision so that offset:1 returns the first one
      await Revision.create({
        documentId: document.id,
        userId: document.createdById,
        title: document.title,
        text: document.text,
        createdAt: new Date(Date.now() - 1000),
      });

      const task = new DeliverWebhookTask();
      const event: DocumentEvent = {
        name: "documents.update",
        documentId: document.id,
        collectionId: document.collectionId!,
        teamId: subscription.teamId,
        actorId: document.createdById,
        createdAt: new Date().toISOString(),
        ip,
      };

      await task.perform({ subscriptionId: subscription.id, event });

      const parsedBody = JSON.parse(
        fetchMock.mock.calls[0]![1]!.body!.toString()
      );

      expect(parsedBody.payload.changes).toBeDefined();
      expect(parsedBody.payload.changes.added).toContain("new line three");
      expect(parsedBody.payload.changes.removed).toContain("old line two");
      expect(parsedBody.payload.changes.modified).toBeUndefined();
    });

    test("omits changes from payload when includeChanges is false", async () => {
      fetchMock.mockResponse("SUCCESS", { status: 200 });

      const subscription = await buildWebhookSubscription({
        url: "http://example.com",
        events: ["documents.update"],
        includeChanges: false,
      });

      const document = await buildDocument({ teamId: subscription.teamId });

      await Revision.create({
        documentId: document.id,
        userId: document.createdById,
        title: document.title,
        text: "some old text\n",
        createdAt: new Date(Date.now() - 2000),
      });

      // Second revision so offset:1 finds the first one
      await Revision.create({
        documentId: document.id,
        userId: document.createdById,
        title: document.title,
        text: "some new text\n",
        createdAt: new Date(Date.now() - 1000),
      });

      const task = new DeliverWebhookTask();
      const event: DocumentEvent = {
        name: "documents.update",
        documentId: document.id,
        collectionId: document.collectionId!,
        teamId: subscription.teamId,
        actorId: document.createdById,
        createdAt: new Date().toISOString(),
        ip,
      };

      await task.perform({ subscriptionId: subscription.id, event });

      const parsedBody = JSON.parse(
        fetchMock.mock.calls[0]![1]!.body!.toString()
      );

      expect(parsedBody.payload.changes).toBeUndefined();
    });

    test("omits changes when no previous revision exists even if includeChanges is true", async () => {
      fetchMock.mockResponse("SUCCESS", { status: 200 });

      const subscription = await buildWebhookSubscription({
        url: "http://example.com",
        events: ["documents.update"],
        includeChanges: true,
      });

      const document = await buildDocument({ teamId: subscription.teamId });

      // Only one revision — offset:1 will return null
      await Revision.create({
        documentId: document.id,
        userId: document.createdById,
        title: document.title,
        text: document.text,
        createdAt: new Date(),
      });

      const task = new DeliverWebhookTask();
      const event: DocumentEvent = {
        name: "documents.update",
        documentId: document.id,
        collectionId: document.collectionId!,
        teamId: subscription.teamId,
        actorId: document.createdById,
        createdAt: new Date().toISOString(),
        ip,
      };

      await task.perform({ subscriptionId: subscription.id, event });

      const parsedBody = JSON.parse(
        fetchMock.mock.calls[0]![1]!.body!.toString()
      );

      expect(parsedBody.payload.changes).toBeUndefined();
    });
  });
});
