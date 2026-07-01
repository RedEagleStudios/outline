import { randomUUID } from "node:crypto";
import type { ExcalidrawScene } from "@server/models/ExcalidrawDrawingRevision";
import { ExcalidrawDrawingRevision } from "@server/models";
import { buildDocument, buildShare, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

const scene: ExcalidrawScene = {
  type: "excalidraw",
  version: 2,
  source: "outline-test",
  elements: [],
  appState: {},
  files: {},
};

describe("#excalidraw.create", () => {
  it("should create an immutable drawing revision", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const drawingId = randomUUID();

    const res = await server.post("/api/excalidraw.create", {
      body: {
        token: user.getJwtToken(),
        documentId: document.id,
        drawingId,
        scene,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.documentId).toEqual(document.id);
    expect(body.data.drawingId).toEqual(drawingId);
    expect(body.data.scene).toEqual(scene);

    const revision = await ExcalidrawDrawingRevision.findByPk(body.data.id, {
      rejectOnEmpty: true,
    });
    expect(revision.teamId).toEqual(user.teamId);
    expect(revision.createdById).toEqual(user.id);
    expect(revision.checksum).toHaveLength(64);
  });

  it("should reject embedded files", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });

    const res = await server.post("/api/excalidraw.create", {
      body: {
        token: user.getJwtToken(),
        documentId: document.id,
        scene: {
          ...scene,
          files: {
            file1: { mimeType: "image/png" },
          },
        },
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toEqual("Embedded Excalidraw files are not supported yet");
  });

  it("should reject oversized scenes", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });

    const res = await server.post("/api/excalidraw.create", {
      body: {
        token: user.getJwtToken(),
        documentId: document.id,
        scene: {
          ...scene,
          elements: [
            {
              id: "oversized",
              data: "x".repeat(65 * 1024),
            },
          ],
        },
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toContain("Element is too large");
  });

  it("should reject stale base revisions", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const drawingId = randomUUID();

    const first = await server.post("/api/excalidraw.create", {
      body: {
        token: user.getJwtToken(),
        documentId: document.id,
        drawingId,
        scene,
      },
    });
    expect(first.status).toEqual(200);

    const stale = await server.post("/api/excalidraw.create", {
      body: {
        token: user.getJwtToken(),
        documentId: document.id,
        drawingId,
        baseDrawingRevisionId: randomUUID(),
        scene,
      },
    });
    const body = await stale.json();

    expect(stale.status).toEqual(400);
    expect(body.message).toEqual("The drawing has been updated since it was opened");
  });

  it("should require update permission on the document", async () => {
    const user = await buildUser();
    const otherUser = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });

    const res = await server.post("/api/excalidraw.create", {
      body: {
        token: otherUser.getJwtToken(),
        documentId: document.id,
        scene,
      },
    });

    expect(res.status).toEqual(403);
  });
});

describe("#excalidraw.info", () => {
  it("should return a drawing revision with document read permission", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const revision = await ExcalidrawDrawingRevision.create({
      drawingId: randomUUID(),
      documentId: document.id,
      teamId: user.teamId,
      createdById: user.id,
      scene,
      preview: null,
      checksum: "abc",
    });

    const res = await server.post("/api/excalidraw.info", {
      body: {
        token: user.getJwtToken(),
        id: revision.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.id).toEqual(revision.id);
    expect(body.data.scene).toEqual(scene);
  });

  it("should require read permission on the document", async () => {
    const user = await buildUser();
    const otherUser = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const revision = await ExcalidrawDrawingRevision.create({
      drawingId: randomUUID(),
      documentId: document.id,
      teamId: user.teamId,
      createdById: user.id,
      scene,
      preview: null,
      checksum: "abc",
    });

    const res = await server.post("/api/excalidraw.info", {
      body: {
        token: otherUser.getJwtToken(),
        id: revision.id,
      },
    });

    expect(res.status).toEqual(403);
  });

  it("should return a drawing revision for a public share without authentication", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const share = await buildShare({
      documentId: document.id,
      teamId: user.teamId,
      userId: user.id,
    });
    const revision = await ExcalidrawDrawingRevision.create({
      drawingId: randomUUID(),
      documentId: document.id,
      teamId: user.teamId,
      createdById: user.id,
      scene,
      preview: null,
      checksum: "abc",
    });

    const res = await server.post("/api/excalidraw.info", {
      body: {
        id: revision.id,
        shareId: share.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.id).toEqual(revision.id);
  });

  it("should reject a drawing revision outside the public share", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const otherDocument = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const share = await buildShare({
      documentId: document.id,
      teamId: user.teamId,
      userId: user.id,
    });
    const revision = await ExcalidrawDrawingRevision.create({
      drawingId: randomUUID(),
      documentId: otherDocument.id,
      teamId: user.teamId,
      createdById: user.id,
      scene,
      preview: null,
      checksum: "abc",
    });

    const res = await server.post("/api/excalidraw.info", {
      body: {
        id: revision.id,
        shareId: share.id,
      },
    });

    expect(res.status).toEqual(403);
  });
});
