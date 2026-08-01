import { Schema, type Node as ProsemirrorNode } from "prosemirror-model";
import { history, redo, undo } from "prosemirror-history";
import { EditorState, type Command } from "prosemirror-state";
import {
  defaultDropdownDefinition,
  getDocumentDropdownDefinitions,
  getDropdownDefinition,
  type DropdownDefinition,
} from "./dropdowns";

const schema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
    dropdown_definition: {
      group: "block",
      attrs: {
        id: {},
        name: {},
        options: {},
      },
    },
  },
});

const option = { id: "todo", label: "Todo", color: "#fff" };

function definition(id: string, name: string): DropdownDefinition {
  return { id, name, options: [option] };
}

function documentWith(...definitions: DropdownDefinition[]): ProsemirrorNode {
  return schema.node(
    "doc",
    undefined,
    definitions.map((attrs) => schema.node("dropdown_definition", attrs))
  );
}

function applyCommand(state: EditorState, command: Command): EditorState {
  let nextState = state;
  const applied = command(state, (transaction) => {
    nextState = state.apply(transaction);
  });
  if (!applied || nextState === state) {
    throw new Error("Expected history command to update editor state");
  }
  return nextState;
}

describe("dropdown definitions", () => {
  it("traverses each document identity once while returning independent arrays", () => {
    const doc = documentWith(definition("status", "First"));
    const descendants = jest.spyOn(doc, "descendants");

    const first = getDocumentDropdownDefinitions(doc);
    first.length = 0;
    const second = getDocumentDropdownDefinitions(doc);

    expect(descendants).toHaveBeenCalledTimes(1);
    expect(second).toEqual([definition("status", "First")]);
    expect(second).not.toBe(first);
  });

  it("isolates structurally equal documents by identity", () => {
    const firstDoc = documentWith(definition("status", "First"));
    const secondDoc = documentWith(definition("status", "First"));
    const firstDescendants = jest.spyOn(firstDoc, "descendants");
    const secondDescendants = jest.spyOn(secondDoc, "descendants");

    getDocumentDropdownDefinitions(firstDoc);
    getDocumentDropdownDefinitions(firstDoc);
    getDocumentDropdownDefinitions(secondDoc);

    expect(firstDescendants).toHaveBeenCalledTimes(1);
    expect(secondDescendants).toHaveBeenCalledTimes(1);
  });

  it("resolves definitions across a transaction and undo-redo history", () => {
    const first = definition("status", "First");
    const second = definition("status", "Second");
    let state = EditorState.create({
      doc: documentWith(first),
      plugins: [history()],
      schema,
    });
    const initialDoc = state.doc;

    expect(getDropdownDefinition(state.doc, { dropdownId: "status" })).toEqual(
      first
    );
    state = state.apply(
      state.tr.setNodeMarkup(0, undefined, {
        ...second,
      })
    );
    const changedDoc = state.doc;
    expect(changedDoc).not.toBe(initialDoc);
    expect(getDropdownDefinition(state.doc, { dropdownId: "status" })).toEqual(
      second
    );

    state = applyCommand(state, undo);
    expect(state.doc).not.toBe(changedDoc);
    expect(getDropdownDefinition(state.doc, { dropdownId: "status" })).toEqual(
      first
    );

    state = applyCommand(state, redo);
    expect(getDropdownDefinition(state.doc, { dropdownId: "status" })).toEqual(
      second
    );
  });

  it("preserves definition order and first duplicate precedence", () => {
    const first = definition("status", "First");
    const second = definition("status", "Second");
    const doc = documentWith(first, second);

    expect(getDocumentDropdownDefinitions(doc)).toEqual([first, second]);
    expect(getDropdownDefinition(doc, { dropdownId: "status" })).toEqual(first);
  });

  it("uses the default for empty documents and missing definitions", () => {
    const doc = documentWith();

    expect(getDocumentDropdownDefinitions(doc)).toEqual([]);
    expect(getDropdownDefinition(doc, { dropdownId: "missing" })).toBe(
      defaultDropdownDefinition
    );
  });

  it("prefers matching definitions and preserves legacy fallback", () => {
    const current = definition("current", "Current");
    const legacy = definition("legacy", "Legacy");
    const doc = documentWith(current);

    expect(
      getDropdownDefinition(doc, {
        dropdownId: "current",
        name: legacy.name,
        options: legacy.options,
      })
    ).toEqual(current);
    expect(
      getDropdownDefinition(doc, {
        dropdownId: "legacy",
        name: legacy.name,
        options: legacy.options,
      })
    ).toEqual(legacy);
  });
});
