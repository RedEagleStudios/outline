import { createEditorState, doc, p, table, td, tr } from "@shared/test/editor";
import { transactionChangesTableStructure } from "./transactionChangesTableStructure";

describe("transactionChangesTableStructure", () => {
  it("uses each step's own pre-step document for table attribute steps", () => {
    const state = createEditorState(doc(table([tr([td("Cell")])])));
    const leadingParagraph = p("x".repeat(100));
    const transaction = state.tr.insert(0, leadingParagraph);
    const shiftedTablePos = leadingParagraph.nodeSize;

    expect(shiftedTablePos).toBeGreaterThan(state.doc.content.size);

    transaction.setNodeAttribute(shiftedTablePos, "layout", "wide");

    expect(transactionChangesTableStructure(transaction)).toBe(true);
  });

  it("ignores attribute changes on non-table nodes", () => {
    const state = createEditorState(doc(p("Paragraph")));
    const transaction = state.tr.setNodeAttribute(0, "id", "paragraph-id");

    expect(transactionChangesTableStructure(transaction)).toBe(false);
  });

  it("recognizes table insertion and deletion", () => {
    const paragraphState = createEditorState(doc(p("Paragraph")));
    const insertedTable = table([tr([td("Cell")])]);
    const insertion = paragraphState.tr.insert(
      paragraphState.doc.content.size,
      insertedTable
    );
    expect(transactionChangesTableStructure(insertion)).toBe(true);

    const tableState = createEditorState(doc(insertedTable));
    const deletion = tableState.tr.delete(0, tableState.doc.content.size);
    expect(transactionChangesTableStructure(deletion)).toBe(true);
  });
});
