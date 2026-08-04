import { Node as ProsemirrorNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { createEditorState, schema } from "@shared/test/editor";
import { defaultDropdownDefinition } from "../lib/dropdowns";
import Dropdown from "./Dropdown";

function dropdown(
  id: string | undefined,
  attrs: Record<string, object | string | undefined> = {}
): ProsemirrorNode {
  return schema.nodes.dropdown.create({
    id,
    dropdownId: "default",
    selectedOptionId: "todo",
    ...attrs,
  });
}

function paragraph(content: ProsemirrorNode[] = []): ProsemirrorNode {
  return schema.nodes.paragraph.create(null, content);
}

function doc(content: ProsemirrorNode[]): ProsemirrorNode {
  return schema.nodes.doc.create(null, content);
}

function createState(document: ProsemirrorNode, plugins: Plugin[] = []) {
  return createEditorState(document, [...plugins, ...new Dropdown().plugins]);
}

function watchTraversals() {
  return jest.spyOn(ProsemirrorNode.prototype, "descendants");
}

describe("dropdown repair plugin", () => {
  afterEach(() => jest.restoreAllMocks());

  it("does not traverse valid documents for meta or selection transactions", () => {
    const traversal = watchTraversals();
    const state = createState(doc([paragraph([dropdown("first")])]));
    traversal.mockClear();

    const metaResult = state.applyTransaction(state.tr.setMeta("test", true));
    const selectionResult = metaResult.state.applyTransaction(
      metaResult.state.tr.setSelection(
        TextSelection.create(metaResult.state.doc, 1)
      )
    );

    expect(metaResult.transactions).toHaveLength(1);
    expect(selectionResult.transactions).toHaveLength(1);
    expect(traversal).not.toHaveBeenCalled();
  });

  it("does not traverse for production-style option selection", () => {
    const traversal = watchTraversals();
    const state = createState(doc([paragraph([dropdown("first")])]));
    traversal.mockClear();

    const result = state.applyTransaction(
      state.tr.setNodeAttribute(1, "selectedOptionId", "done")
    );

    expect(result.transactions).toHaveLength(1);
    expect(traversal).not.toHaveBeenCalled();
  });

  it("never lets option selection bypass malformed initial repair", () => {
    const state = createState(doc([paragraph([dropdown(undefined)])]));

    const result = state.applyTransaction(
      state.tr.setNodeAttribute(1, "selectedOptionId", "done")
    );

    expect(result.transactions).toHaveLength(2);
    expect(typeof result.state.doc.nodeAt(1)?.attrs.id).toBe("string");
  });

  it("repairs missing ids and legacy dropdown defaults", () => {
    const state = createState(
      doc([
        paragraph([
          dropdown(undefined),
          dropdown("legacy", { dropdownId: undefined, options: [] }),
        ]),
      ])
    );

    const result = state.applyTransaction(state.tr.setMeta("test", true));

    expect(result.transactions).toHaveLength(2);
    expect(typeof result.state.doc.nodeAt(1)?.attrs.id).toBe("string");
    expect(result.state.doc.nodeAt(2)?.attrs.dropdownId).toBe(
      defaultDropdownDefinition.id
    );
  });

  it("gives an inserted duplicate before the original ownership", () => {
    const state = createState(doc([paragraph([dropdown("duplicate")])]));

    const result = state.applyTransaction(
      state.tr.insert(1, dropdown("duplicate"))
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.state.doc.nodeAt(1)?.attrs.id).toBe("duplicate");
    expect(result.state.doc.nodeAt(2)?.attrs.id).not.toBe("duplicate");
  });

  it("keeps original ownership when a duplicate is inserted after it", () => {
    const state = createState(doc([paragraph([dropdown("duplicate")])]));

    const result = state.applyTransaction(
      state.tr.insert(2, dropdown("duplicate"))
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.state.doc.nodeAt(1)?.attrs.id).toBe("duplicate");
    expect(result.state.doc.nodeAt(2)?.attrs.id).not.toBe("duplicate");
  });

  it("full-scans multi-step duplicate insertion", () => {
    const traversal = watchTraversals();
    const state = createState(doc([paragraph([dropdown("original")])]));
    traversal.mockClear();
    const transaction = state.tr
      .insert(2, dropdown("multi"))
      .insert(3, dropdown("multi"));

    const result = state.applyTransaction(transaction);

    expect(traversal).toHaveBeenCalled();
    expect(result.transactions).toHaveLength(2);
    expect(result.state.doc.nodeAt(2)?.attrs.id).toBe("multi");
    expect(result.state.doc.nodeAt(3)?.attrs.id).not.toBe("multi");
  });

  it("full-scans broad Yjs-like replacements", () => {
    const traversal = watchTraversals();
    const state = createState(doc([paragraph([dropdown("original")])]));
    traversal.mockClear();
    const replacement = paragraph([dropdown("remote"), dropdown("remote")]);

    const result = state.applyTransaction(
      state.tr.replaceWith(0, state.doc.content.size, replacement)
    );

    expect(traversal).toHaveBeenCalled();
    expect(result.transactions).toHaveLength(2);
  });

  it("full-scans ambiguous appended transaction chains", () => {
    const appender = new Plugin({
      appendTransaction: (transactions, _oldState, newState) =>
        transactions.some((transaction) => transaction.getMeta("appended"))
          ? null
          : newState.tr.setMeta("appended", true),
    });
    const traversal = watchTraversals();
    const state = createState(
      doc([paragraph([schema.text("text"), dropdown("first")])]),
      [appender]
    );
    traversal.mockClear();

    state.applyTransaction(state.tr.insertText("!", 2));

    expect(traversal).toHaveBeenCalled();
  });

  it("bounds malformed repair to one appended transaction", () => {
    const state = createState(doc([paragraph([dropdown(undefined)])]));

    const result = state.applyTransaction(state.tr.setMeta("test", true));

    expect(result.transactions).toHaveLength(2);
  });
});
