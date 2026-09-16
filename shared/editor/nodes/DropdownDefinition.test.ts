import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { AllSelection, TextSelection } from "prosemirror-state";
import {
  createEditorState,
  doc,
  p,
  schema,
  table,
  tr,
} from "@shared/test/editor";
import {
  getDocumentDropdownDefinitions,
  getDropdownDefinition,
  getSelectedDropdownOption,
} from "../lib/dropdowns";
import DropdownDefinition from "./DropdownDefinition";

const definition = {
  id: "workspace-status",
  name: "Issue status",
  options: [
    { id: "workspace-open", label: "Open", color: "#FF0000" },
    { id: "workspace-solved", label: "Solved", color: "#00FF00" },
  ],
};

function setup() {
  const tableNode = table([
    tr(
      definition.options.map((option) =>
        schema.nodes.td.create(null, [
          schema.nodes.paragraph.create(null, [
            schema.nodes.dropdown.create({
              id: `chip-${option.id}`,
              dropdownId: definition.id,
              selectedOptionId: option.id,
            }),
          ]),
        ])
      )
    ),
  ]);
  const document = doc([
    tableNode,
    schema.nodes.dropdown_definition.create(definition),
    p("After table"),
  ]);
  const state = createEditorState(document, [
    history(),
    ...new DropdownDefinition().plugins,
  ]);
  return {
    state,
    definitionPos: tableNode.nodeSize,
    paragraphPos: tableNode.nodeSize + 2,
  };
}

function labels(document: ProsemirrorNode) {
  const result: string[] = [];
  document.descendants((node) => {
    if (node.type.name === "dropdown") {
      result.push(
        getSelectedDropdownOption(
          getDropdownDefinition(document, node.attrs),
          node.attrs.selectedOptionId
        ).label
      );
    }
  });
  return result;
}

function applyCommand(state: EditorState, command: Command) {
  let next = state;
  expect(
    command(state, (transaction) => {
      next = state.applyTransaction(transaction).state;
    })
  ).toBe(true);
  return next;
}

describe("dropdown definition preservation", () => {
  it("keeps table statuses when Backspace deletes hidden metadata after the table", () => {
    const { state, paragraphPos } = setup();
    const selected = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, paragraphPos))
    );
    const next = applyCommand(selected, baseKeymap.Backspace);

    expect(labels(next.doc)).toEqual(["Open", "Solved"]);
    expect(next.doc.textContent).toContain("After table");
    expect(getDocumentDropdownDefinitions(next.doc)).toEqual([definition]);
  });

  it("keeps referenced definitions when a range deletion crosses hidden metadata", () => {
    const { state, definitionPos, paragraphPos } = setup();
    const next = state.applyTransaction(
      state.tr.delete(definitionPos, paragraphPos + 5)
    ).state;

    expect(labels(next.doc)).toEqual(["Open", "Solved"]);
    expect(next.doc.textContent).toContain(" table");
  });

  it("does not resurrect metadata when all its chips are deleted", () => {
    const { state } = setup();
    const selected = state.apply(
      state.tr.setSelection(new AllSelection(state.doc))
    );
    const next = applyCommand(selected, baseKeymap.Backspace);

    expect(next.doc.eq(doc(p("")))).toBe(true);
    expect(getDocumentDropdownDefinitions(next.doc)).toEqual([]);
  });

  it("preserves statuses through undo and redo without duplicating definitions", () => {
    const { state, paragraphPos } = setup();
    const selected = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, paragraphPos))
    );
    const deleted = applyCommand(selected, baseKeymap.Backspace);
    const undone = applyCommand(deleted, undo);
    const redone = applyCommand(undone, redo);

    expect(undone.doc.eq(state.doc)).toBe(true);
    expect(labels(redone.doc)).toEqual(["Open", "Solved"]);
    expect(getDocumentDropdownDefinitions(redone.doc)).toEqual([definition]);
  });

  it("accepts replacement definitions instead of restoring stale options", () => {
    const { state, definitionPos } = setup();
    const updated = {
      ...definition,
      options: definition.options.map((option) => ({
        ...option,
        label: `${option.label} updated`,
      })),
    };
    const next = state.applyTransaction(
      state.tr.replaceWith(
        definitionPos,
        definitionPos + 1,
        schema.nodes.dropdown_definition.create(updated)
      )
    ).state;

    expect(labels(next.doc)).toEqual(["Open updated", "Solved updated"]);
    expect(getDocumentDropdownDefinitions(next.doc)).toEqual([updated]);
  });
});
