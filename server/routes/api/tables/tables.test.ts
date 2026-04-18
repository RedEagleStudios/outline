import type { ProsemirrorData } from "@shared/types";
import { buildDocument, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

/**
 * Builds a two-row / two-column table ProseMirror document for tests.
 */
function tableDocContent(): ProsemirrorData {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tr",
            content: [
              {
                type: "th",
                attrs: { colspan: 1, rowspan: 1 },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "H1" }],
                  },
                ],
              },
              {
                type: "th",
                attrs: { colspan: 1, rowspan: 1 },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "H2" }],
                  },
                ],
              },
            ],
          },
          {
            type: "tr",
            content: [
              {
                type: "td",
                attrs: { colspan: 1, rowspan: 1 },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "A" }],
                  },
                ],
              },
              {
                type: "td",
                attrs: { colspan: 1, rowspan: 1 },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "B" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Fetches the current PM JSON of a document via the public documents.data
 * endpoint and returns the table node at `tableIndex`.
 */
async function fetchTable(
  token: string,
  documentId: string,
  tableIndex = 0
): Promise<ProsemirrorData> {
  const res = await server.post("/api/documents.data", {
    body: { token, id: documentId },
  });
  expect(res.status).toEqual(200);
  const { data } = await res.json();
  const tables = (data.content ?? []).filter(
    (n: ProsemirrorData) => n.type === "table"
  );
  return tables[tableIndex];
}

describe("#tables.setCellBackground", () => {
  it("sets a cell background color and exposes it on documents.data", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.setCellBackground", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        row: 1,
        col: 0,
        color: "#ffcc00",
      },
    });
    expect(res.status).toEqual(200);

    const table = await fetchTable(user.getJwtToken(), document.id);
    const targetCell = (table.content as ProsemirrorData[])[1]
      .content![0] as ProsemirrorData;
    const marks = (targetCell.attrs?.marks ?? []) as Array<{
      type: string;
      attrs: { color: string };
    }>;
    const bg = marks.find((m) => m.type === "background");
    expect(bg).toBeDefined();
    expect(bg?.attrs.color).toEqual("#ffcc00");
  });

  it("clears the background when color is null", async () => {
    const user = await buildUser();
    const doc = tableDocContent();
    const cell = (doc.content![0].content![1].content![0] as ProsemirrorData);
    cell.attrs = {
      ...(cell.attrs ?? {}),
      marks: [{ type: "background", attrs: { color: "#ff0000" } }],
    };
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: doc,
    });

    const res = await server.post("/api/tables.setCellBackground", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        row: 1,
        col: 0,
        color: null,
      },
    });
    expect(res.status).toEqual(200);

    const table = await fetchTable(user.getJwtToken(), document.id);
    const targetCell = (table.content as ProsemirrorData[])[1]
      .content![0] as ProsemirrorData;
    const marks = (targetCell.attrs?.marks ?? []) as Array<{ type: string }>;
    expect(marks.find((m) => m.type === "background")).toBeUndefined();
  });

  it("rejects invalid table index", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.setCellBackground", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 99,
        row: 0,
        col: 0,
        color: "#abcdef",
      },
    });
    expect(res.status).toEqual(400);
  });

  it("returns 403 for user without access", async () => {
    const user = await buildUser();
    const stranger = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.setCellBackground", {
      body: {
        token: stranger.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        row: 0,
        col: 0,
        color: "#abcdef",
      },
    });
    expect(res.status).toEqual(403);
  });
});

describe("#tables.setColumnWidth", () => {
  it("updates colwidth on cells in the target column", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.setColumnWidth", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        col: 1,
        width: 320,
      },
    });
    expect(res.status).toEqual(200);

    const table = await fetchTable(user.getJwtToken(), document.id);
    const rows = table.content as ProsemirrorData[];
    for (const row of rows) {
      const cell = row.content![1] as ProsemirrorData;
      const widths = cell.attrs?.colwidth as number[] | null | undefined;
      expect(Array.isArray(widths)).toBe(true);
      expect(widths![0]).toEqual(320);
    }
  });

  it("rejects out-of-range columns", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.setColumnWidth", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        col: 99,
        width: 200,
      },
    });
    expect(res.status).toEqual(400);
  });
});

describe("#tables.mergeCells", () => {
  it("merges two adjacent cells in a single row", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.mergeCells", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        fromRow: 1,
        fromCol: 0,
        toRow: 1,
        toCol: 1,
      },
    });
    expect(res.status).toEqual(200);

    const table = await fetchTable(user.getJwtToken(), document.id);
    const rows = table.content as ProsemirrorData[];
    // Second row should have a single surviving cell with colspan=2.
    expect(rows[1].content!.length).toEqual(1);
    const survivor = rows[1].content![0] as ProsemirrorData;
    expect(survivor.attrs?.colspan).toEqual(2);
  });

  it("merges a 2x2 rectangle across rows", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.mergeCells", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        fromRow: 0,
        fromCol: 0,
        toRow: 1,
        toCol: 1,
      },
    });
    expect(res.status).toEqual(200);

    const table = await fetchTable(user.getJwtToken(), document.id);
    const rows = table.content as ProsemirrorData[];
    expect(rows[0].content!.length).toEqual(1);
    const survivor = rows[0].content![0] as ProsemirrorData;
    expect(survivor.attrs?.colspan).toEqual(2);
    expect(survivor.attrs?.rowspan).toEqual(2);
    expect((rows[1].content ?? []).length).toEqual(0);
  });

  it("rejects degenerate 1x1 merge", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.mergeCells", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        fromRow: 0,
        fromCol: 0,
        toRow: 0,
        toCol: 0,
      },
    });
    expect(res.status).toEqual(400);
  });
});

describe("#tables.splitCell", () => {
  it("splits a merged cell back into 1x1 cells", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    // First, merge row 1 fully.
    const mergeRes = await server.post("/api/tables.mergeCells", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        fromRow: 1,
        fromCol: 0,
        toRow: 1,
        toCol: 1,
      },
    });
    expect(mergeRes.status).toEqual(200);

    // Then split it.
    const splitRes = await server.post("/api/tables.splitCell", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        row: 1,
        col: 0,
      },
    });
    expect(splitRes.status).toEqual(200);

    const table = await fetchTable(user.getJwtToken(), document.id);
    const rows = table.content as ProsemirrorData[];
    expect(rows[1].content!.length).toEqual(2);
    expect((rows[1].content![0] as ProsemirrorData).attrs?.colspan).toEqual(1);
    expect((rows[1].content![1] as ProsemirrorData).attrs?.colspan).toEqual(1);
  });

  it("rejects splitting an unmerged cell", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      content: tableDocContent(),
    });

    const res = await server.post("/api/tables.splitCell", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        tableIndex: 0,
        row: 0,
        col: 0,
      },
    });
    expect(res.status).toEqual(400);
  });
});
