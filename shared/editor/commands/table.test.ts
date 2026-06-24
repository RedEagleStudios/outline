import type { Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import {
  createEditorState,
  doc,
  schema,
  table,
  td,
  tr,
} from "@shared/test/editor";
import {
  addRowAndMoveSelection,
  indentSelectedTableText,
  setCellSelectionAttr,
  setRowAttr,
} from "./table";

function getTextPosition(
  state: ReturnType<typeof createEditorState>,
  text: string
) {
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

describe("addRowAndMoveSelection", () => {
  it("copies dropdown chips from the source row into the new row", () => {
    const dropdown = schema.nodes.dropdown.create({
      id: "dropdown-1",
      dropdownId: "status",
      selectedOptionId: "open",
      name: "Status",
      options: [
        {
          id: "open",
          label: "Open Issue",
          color: "#BA1A1A",
        },
      ],
    });
    const sourceCell: ReturnType<typeof td> = schema.nodes.td.create(
      null,
      schema.nodes.paragraph.create(null, [dropdown, schema.text(" Source")])
    );
    const state = createEditorState(doc(table([tr([sourceCell])])));
    const textPosition = getTextPosition(state, " Source");
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, textPosition))
    );
    let transaction: Transaction | undefined;

    const handled = addRowAndMoveSelection()(selectedState, (tr) => {
      transaction = tr;
    });

    expect(handled).toBe(true);

    const nextState = selectedState.apply(transaction!);
    const newCell = nextState.doc.firstChild!.child(1).child(0);
    const dropdowns: string[] = [];

    newCell.descendants((node) => {
      if (node.type.name === "dropdown") {
        dropdowns.push(node.attrs.selectedOptionId);
      }
    });

    expect(dropdowns).toEqual(["open"]);
  });
});

describe("setRowAttr", () => {
  it("sets text alignment for every cell in a row", () => {
    const state = createEditorState(
      doc(
        table([
          tr([td("A"), td("B")]),
          tr([td("C", { alignment: "right" }), td("D")]),
        ])
      )
    );
    const textPosition = getTextPosition(state, "C");
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, textPosition))
    );
    let transaction: Transaction | undefined;

    const handled = setRowAttr({ index: 1, alignment: "center" })(
      selectedState,
      (tr) => {
        transaction = tr;
      }
    );

    expect(handled).toBe(true);

    if (!transaction) {
      throw new Error("Expected setRowAttr to dispatch a transaction");
    }

    const nextState = selectedState.apply(transaction);
    const firstRow = nextState.doc.firstChild?.child(0);
    const secondRow = nextState.doc.firstChild?.child(1);

    expect(firstRow?.child(0).attrs.alignment).toBe(null);
    expect(firstRow?.child(1).attrs.alignment).toBe(null);
    expect(secondRow?.child(0).attrs.alignment).toBe("center");
    expect(secondRow?.child(1).attrs.alignment).toBe("center");
  });
});

describe("setCellSelectionAttr", () => {
  it("sets text alignment for selected cells only", () => {
    const state = createEditorState(
      doc(table([tr([td("A"), td("B")]), tr([td("C"), td("D")])]))
    );
    const cellPositions: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === "td") {
        cellPositions.push(pos);
      }
    });
    const selectedState = state.apply(
      state.tr.setSelection(
        new CellSelection(
          state.doc.resolve(cellPositions[0]),
          state.doc.resolve(cellPositions[1])
        )
      )
    );
    let transaction: Transaction | undefined;

    const handled = setCellSelectionAttr({ alignment: "right" })(
      selectedState,
      (tr) => {
        transaction = tr;
      }
    );

    expect(handled).toBe(true);

    if (!transaction) {
      throw new Error(
        "Expected setCellSelectionAttr to dispatch a transaction"
      );
    }

    const nextState = selectedState.apply(transaction);
    const firstRow = nextState.doc.firstChild?.child(0);
    const secondRow = nextState.doc.firstChild?.child(1);

    expect(firstRow?.child(0).attrs.alignment).toBe("right");
    expect(firstRow?.child(1).attrs.alignment).toBe("right");
    expect(secondRow?.child(0).attrs.alignment).toBe(null);
    expect(secondRow?.child(1).attrs.alignment).toBe(null);
  });
});
