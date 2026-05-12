import type { Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { createEditorState, doc, table, td, tr } from "@shared/test/editor";
import { indentSelectedTableText } from "./table";

function getTextPosition(state: ReturnType<typeof createEditorState>, text: string) {
  let textPosition = 0;

  state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      textPosition = pos;
      return false;
    }

    return true;
  });

  return textPosition;
}

describe("indentSelectedTableText", () => {
  it("indents a text selection inside a table cell", () => {
    const state = createEditorState(doc(table([tr([td("Cell")])])));
    const textPosition = getTextPosition(state, "Cell");
    const selectedState = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, textPosition, textPosition + 4)
      )
    );
    let transaction: Transaction | undefined;

    const handled = indentSelectedTableText(selectedState, (tr) => {
      transaction = tr;
    });

    expect(handled).toBe(true);

    const nextState = selectedState.apply(transaction!);
    const cell = nextState.doc.firstChild!.child(0).child(0);

    expect(cell.textContent).toBe("  Cell");
    expect(nextState.selection.from).toBe(textPosition + 2);
    expect(nextState.selection.to).toBe(textPosition + 6);
  });

  it("does not handle an empty selection", () => {
    const state = createEditorState(doc(table([tr([td("Cell")])])));
    const textPosition = getTextPosition(state, "Cell");
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, textPosition))
    );

    expect(indentSelectedTableText(selectedState)).toBe(false);
  });
});
