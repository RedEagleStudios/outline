import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { createEditorState, schema } from "@shared/test/editor";
import {
  backspaceEmptyOrderedListItem,
  backspaceEmptyListItem,
  indentSelectedListItems,
  outdentSelectedListItems,
} from "./ListItem";

function paragraph(text = ""): ProsemirrorNode {
  return schema.nodes.paragraph.create(
    null,
    text ? schema.text(text) : undefined
  );
}

function listItem(content: ProsemirrorNode[]): ProsemirrorNode {
  return schema.nodes.list_item.create(null, content);
}

function orderedList(items: ProsemirrorNode[]): ProsemirrorNode {
  return schema.nodes.ordered_list.create(null, items);
}

function bulletList(items: ProsemirrorNode[]): ProsemirrorNode {
  return schema.nodes.bullet_list.create(null, items);
}

function getTextPosition(doc: ProsemirrorNode, text: string): number {
  let textPosition = 0;

  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      textPosition = pos;
      return false;
    }

    return true;
  });

  return textPosition;
}

function applyCommandTransactions(
  state: ReturnType<typeof createEditorState>,
  command: Command
) {
  let nextState = state;
  const handled = command(nextState, (tr) => {
    nextState = nextState.apply(tr);
  });

  return { handled, nextState };
}

function stateWithSelectionAtEmptyParagraph(doc: ProsemirrorNode) {
  const state = createEditorState(doc);
  let paragraphPosition = 0;

  state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.paragraph && node.textContent === "") {
      paragraphPosition = pos;
      return false;
    }

    return true;
  });

  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, paragraphPosition + 1))
  );
}

describe("backspaceEmptyOrderedListItem", () => {
  it("reduces the nesting level of an empty ordered list item", () => {
    const testDoc = schema.nodes.doc.create(null, [
      orderedList([
        listItem([
          paragraph("Parent"),
          orderedList([listItem([paragraph()])]),
        ]),
      ]),
    ]);
    const state = stateWithSelectionAtEmptyParagraph(testDoc);
    let transaction: Transaction | undefined;

    const handled = backspaceEmptyOrderedListItem(schema.nodes.list_item)(
      state,
      (tr) => {
        transaction = tr;
      }
    );

    expect(handled).toBe(true);

    const nextState = state.apply(transaction!);
    const list = nextState.doc.firstChild!;

    expect(list.type).toBe(schema.nodes.ordered_list);
    expect(list.childCount).toBe(2);
    expect(list.child(1).type).toBe(schema.nodes.list_item);
    expect(list.child(1).textContent).toBe("");
  });

  it("turns a root empty ordered list item into a paragraph", () => {
    const testDoc = schema.nodes.doc.create(null, [
      orderedList([listItem([paragraph()])]),
    ]);
    const state = stateWithSelectionAtEmptyParagraph(testDoc);
    let transaction: Transaction | undefined;

    const handled = backspaceEmptyOrderedListItem(schema.nodes.list_item)(
      state,
      (tr) => {
        transaction = tr;
      }
    );

    expect(handled).toBe(true);

    const nextState = state.apply(transaction!);

    expect(nextState.doc.firstChild!.type).toBe(schema.nodes.paragraph);
    expect(nextState.doc.firstChild!.textContent).toBe("");
  });

  it("turns only the root empty ordered list item into a paragraph", () => {
    const testDoc = schema.nodes.doc.create(null, [
      orderedList([
        listItem([paragraph("One")]),
        listItem([paragraph()]),
        listItem([paragraph("Three")]),
      ]),
    ]);
    const state = stateWithSelectionAtEmptyParagraph(testDoc);
    let transaction: Transaction | undefined;

    const handled = backspaceEmptyOrderedListItem(schema.nodes.list_item)(
      state,
      (tr) => {
        transaction = tr;
      }
    );

    expect(handled).toBe(true);

    const nextState = state.apply(transaction!);

    expect(nextState.doc.childCount).toBe(3);
    expect(nextState.doc.child(0).type).toBe(schema.nodes.ordered_list);
    expect(nextState.doc.child(0).textContent).toBe("One");
    expect(nextState.doc.child(1).type).toBe(schema.nodes.paragraph);
    expect(nextState.doc.child(1).textContent).toBe("");
    expect(nextState.doc.child(2).type).toBe(schema.nodes.ordered_list);
    expect(nextState.doc.child(2).textContent).toBe("Three");
  });
});

describe("backspaceEmptyListItem", () => {
  it("promotes nested bullet items when deleting an empty parent bullet", () => {
    const testDoc = schema.nodes.doc.create(null, [
      bulletList([
        listItem([paragraph("One")]),
        listItem([
          paragraph(),
          bulletList([
            listItem([paragraph("Two")]),
            listItem([paragraph("Three")]),
          ]),
        ]),
        listItem([paragraph("Four")]),
      ]),
    ]);
    const state = stateWithSelectionAtEmptyParagraph(testDoc);
    let transaction: Transaction | undefined;

    const handled = backspaceEmptyListItem(schema.nodes.list_item)(
      state,
      (tr) => {
        transaction = tr;
      }
    );

    expect(handled).toBe(true);

    const nextState = state.apply(transaction!);
    const list = nextState.doc.firstChild!;

    expect(list.type).toBe(schema.nodes.bullet_list);
    expect(list.childCount).toBe(4);
    expect(list.child(0).textContent).toBe("One");
    expect(list.child(1).textContent).toBe("Two");
    expect(list.child(2).textContent).toBe("Three");
    expect(list.child(3).textContent).toBe("Four");
  });
});

describe("selected list item indentation", () => {
  it("indents every selected ordered list item", () => {
    const testDoc = schema.nodes.doc.create(null, [
      orderedList([
        listItem([paragraph("One")]),
        listItem([paragraph("Two")]),
        listItem([paragraph("Three")]),
      ]),
    ]);
    const state = createEditorState(testDoc);
    const from = getTextPosition(state.doc, "Two");
    const to = getTextPosition(state.doc, "Three") + "Three".length;
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, from, to))
    );

    const { handled, nextState } = applyCommandTransactions(
      selectedState,
      indentSelectedListItems(schema.nodes.list_item)
    );

    expect(handled).toBe(true);

    const list = nextState.doc.firstChild!;
    const firstItem = list.child(0);
    const nestedList = firstItem.child(1);

    expect(list.childCount).toBe(1);
    expect(nestedList.type).toBe(schema.nodes.ordered_list);
    expect(nestedList.childCount).toBe(2);
    expect(nestedList.child(0).textContent).toBe("Two");
    expect(nestedList.child(1).textContent).toBe("Three");
  });

  it("outdents every selected ordered list item", () => {
    const testDoc = schema.nodes.doc.create(null, [
      orderedList([
        listItem([
          paragraph("One"),
          orderedList([
            listItem([paragraph("Two")]),
            listItem([paragraph("Three")]),
          ]),
        ]),
      ]),
    ]);
    const state = createEditorState(testDoc);
    const from = getTextPosition(state.doc, "Two");
    const to = getTextPosition(state.doc, "Three") + "Three".length;
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, from, to))
    );

    const { handled, nextState } = applyCommandTransactions(
      selectedState,
      outdentSelectedListItems(schema.nodes.list_item)
    );

    expect(handled).toBe(true);

    const list = nextState.doc.firstChild!;

    expect(list.type).toBe(schema.nodes.ordered_list);
    expect(list.childCount).toBe(3);
    expect(list.child(0).textContent).toBe("One");
    expect(list.child(1).textContent).toBe("Two");
    expect(list.child(2).textContent).toBe("Three");
  });
});
