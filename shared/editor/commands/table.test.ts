import {
  DOMParser as ProsemirrorDOMParser,
  DOMSerializer,
} from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import {
  createEditorState,
  doc,
  p,
  schema,
  table,
  td,
  tr,
} from "@shared/test/editor";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import {
  addRowAndMoveSelection,
  indentSelectedTableText,
  setCellSelectionAttr,
  setRowAttr,
  sortTable,
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

describe("sortTable", () => {
  const options = [
    { id: "solved", label: "Solved", color: "#17834F" },
    { id: "open", label: "Open Issue", color: "#BA1A1A" },
    { id: "ignored", label: "Ignored", color: "#6B7280" },
  ];

  function dropdownCell(selectedOptionId: string, before = "", after = "") {
    const dropdown = schema.nodes.dropdown.create({
      id: `chip-${selectedOptionId}-${before.length}-${after.length}`,
      dropdownId: "workspace-status",
      selectedOptionId,
    });
    const content = [
      ...(before ? [schema.text(before)] : []),
      dropdown,
      ...(after ? [schema.text(after)] : []),
    ];

    return schema.nodes.td.create(
      null,
      schema.nodes.paragraph.create(null, content)
    );
  }

  function sortedRowNames(direction: "asc" | "desc"): string[] {
    const tableNode = table([
      tr([dropdownCell("open"), td("Open")]),
      tr([dropdownCell("solved", " "), td("Solved leading")]),
      tr([dropdownCell("ignored"), td("Ignored")]),
      tr([dropdownCell("solved", "", "  "), td("Solved trailing")]),
      tr([td(""), td("Empty")]),
    ]);
    const definition = schema.nodes.dropdown_definition.create({
      id: "workspace-status",
      name: "Status",
      options,
    });
    const state = createEditorState(doc([tableNode, definition]));
    const selectedState = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, getTextPosition(state, "Open"))
      )
    );
    let transaction: Transaction | undefined;

    sortTable({ index: 0, direction })(selectedState, (tr) => {
      transaction = tr;
    });
    if (!transaction) {
      throw new Error("Expected sortTable to dispatch a transaction");
    }

    const sortedTable = selectedState.apply(transaction).doc.firstChild;
    if (!sortedTable) {
      throw new Error("Expected a sorted table");
    }

    return Array.from(
      { length: sortedTable.childCount },
      (_, index) => sortedTable.child(index).child(1).textContent
    );
  }

  it("sorts reference-only workspace dropdowns by configured order", () => {
    expect(sortedRowNames("asc")).toEqual([
      "Solved leading",
      "Solved trailing",
      "Open",
      "Ignored",
      "Empty",
    ]);
  });

  it("reverses known option order while keeping equal options stable and empty cells last", () => {
    expect(sortedRowNames("desc")).toEqual([
      "Ignored",
      "Open",
      "Solved leading",
      "Solved trailing",
      "Empty",
    ]);
  });

  it("uses generic text sorting for mixed dropdown and plain-text columns", () => {
    const hydratedDropdown = schema.nodes.dropdown.create({
      id: "mixed-solved",
      dropdownId: "workspace-status",
      selectedOptionId: "solved",
      name: "Status",
      options,
    });
    const dropdownCell = schema.nodes.td.create(
      null,
      schema.nodes.paragraph.create(null, hydratedDropdown)
    );
    const state = createEditorState(
      doc(
        table([
          tr([dropdownCell, td("Dropdown")]),
          tr([td("Open Issue"), td("Plain")]),
        ])
      )
    );
    const selectedState = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, getTextPosition(state, "Plain"))
      )
    );
    let transaction: Transaction | undefined;

    sortTable({ index: 0, direction: "asc" })(selectedState, (tr) => {
      transaction = tr;
    });
    if (!transaction) {
      throw new Error("Expected sortTable to dispatch a transaction");
    }

    const sortedTable = selectedState.apply(transaction).doc.firstChild;
    expect(sortedTable?.child(0).child(1).textContent).toBe("Plain");
    expect(sortedTable?.child(1).child(1).textContent).toBe("Dropdown");
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

describe("table identity attributes", () => {
  const itWithDOM = typeof document === "undefined" ? it.skip : it;

  it("round-trips ids through ProseMirror JSON", () => {
    const tableNode = schema.nodes.table.create(
      { tableId: "table-1" },
      schema.nodes.tr.create(
        { rowId: "row-1" },
        schema.nodes.td.create({ cellId: "cell-1" }, p("Cell"))
      )
    );

    const parsed = schema.nodeFromJSON(tableNode.toJSON());

    expect(parsed.attrs.tableId).toBe("table-1");
    expect(parsed.child(0).attrs.rowId).toBe("row-1");
    expect(parsed.child(0).child(0).attrs.cellId).toBe("cell-1");
  });

  itWithDOM("does not serialize ids into DOM", () => {
    const tableNode = schema.nodes.table.create(
      { tableId: "table-1" },
      schema.nodes.tr.create(
        { rowId: "row-1" },
        schema.nodes.th.create({ cellId: "cell-1" }, p("Cell"))
      )
    );
    const wrapper = document.createElement("div");
    const fragment = DOMSerializer.fromSchema(schema).serializeNode(tableNode);

    wrapper.appendChild(fragment);

    expect(wrapper.querySelector("[data-table-id]")).toBeNull();
    expect(wrapper.querySelector("[data-row-id]")).toBeNull();
    expect(wrapper.querySelector("[data-cell-id]")).toBeNull();
    expect(
      wrapper.querySelector(`.${EditorStyleHelper.tableContentVisibility}`)
    ).toBeNull();
    expect(wrapper.innerHTML).not.toContain("table-1");
    expect(wrapper.innerHTML).not.toContain("row-1");
    expect(wrapper.innerHTML).not.toContain("cell-1");
  });

  itWithDOM("does not serialize runtime containment for nested tables", () => {
    const innerTable = schema.nodes.table.create(
      null,
      schema.nodes.tr.create(null, schema.nodes.td.create(null, p("Inner")))
    );
    const outerTable = schema.nodes.table.create(
      null,
      schema.nodes.tr.create(null, schema.nodes.td.create(null, innerTable))
    );
    const wrapper = document.createElement("div");

    wrapper.appendChild(
      DOMSerializer.fromSchema(schema).serializeNode(outerTable)
    );

    expect(wrapper.querySelectorAll("table")).toHaveLength(2);
    expect(
      wrapper.querySelector(`.${EditorStyleHelper.tableContentVisibility}`)
    ).toBeNull();
    expect(wrapper.innerHTML).not.toContain("--table-intrinsic-block-size");
  });

  itWithDOM("does not parse ids from DOM", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<table data-table-id="table-1"><tbody><tr data-row-id="row-1"><td data-cell-id="cell-1"><p>Cell</p></td></tr></tbody></table>';

    const parsed = ProsemirrorDOMParser.fromSchema(schema).parse(wrapper);
    const tableNode = parsed.firstChild;

    expect(tableNode?.attrs.tableId).toBeNull();
    expect(tableNode?.child(0).attrs.rowId).toBeNull();
    expect(tableNode?.child(0).child(0).attrs.cellId).toBeNull();
  });
});
