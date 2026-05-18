import type { Transaction } from "prosemirror-state";
import {
  createEditorStateWithSelection,
  doc,
  schema,
  table,
  td,
  tr,
} from "@shared/test/editor";
import { listWrappingInputRule } from "./listInputRule";

interface InputRuleWithHandler {
  handler: (
    state: ReturnType<typeof createEditorStateWithSelection>,
    match: RegExpMatchArray,
    start: number,
    end: number
  ) => Transaction | null;
}

describe("listWrappingInputRule", () => {
  it("converts a table cell paragraph into a bullet list", () => {
    const state = createEditorStateWithSelection(
      doc(table([tr([td("-")])])),
      5
    );
    const rule = listWrappingInputRule(
      /^\s*([-+*])\s$/,
      schema.nodes.bullet_list
    ) as ReturnType<typeof listWrappingInputRule> & InputRuleWithHandler;

    const transaction = rule.handler(
      state,
      ["- ", "-"] as unknown as RegExpMatchArray,
      4,
      5
    );

    expect(transaction).not.toBeNull();

    const nextState = state.apply(transaction!);
    const cell = nextState.doc.firstChild!.child(0).child(0);

    expect(cell.firstChild?.type.name).toBe("bullet_list");
    expect(cell.firstChild?.firstChild?.type.name).toBe("list_item");
  });

  it("only converts the current table cell line into a bullet list", () => {
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("before"),
      schema.nodes.br.create(),
      schema.text("-"),
      schema.nodes.br.create(),
      schema.text("after"),
    ]);
    const testDoc = doc(table([tr([schema.nodes.td.create(null, paragraph)])]));
    let triggerPosition = 0;
    testDoc.descendants((node, pos) => {
      if (node.isText && node.text === "-") {
        triggerPosition = pos;
      }
    });
    const state = createEditorStateWithSelection(testDoc, triggerPosition + 1);
    const rule = listWrappingInputRule(
      /^\s*([-+*])\s$/,
      schema.nodes.bullet_list
    ) as ReturnType<typeof listWrappingInputRule> & InputRuleWithHandler;

    const transaction = rule.handler(
      state,
      ["- ", "-"] as unknown as RegExpMatchArray,
      triggerPosition,
      triggerPosition + 1
    );

    expect(transaction).not.toBeNull();

    const nextState = state.apply(transaction!);
    const cell = nextState.doc.firstChild!.child(0).child(0);

    expect(cell.childCount).toBe(3);
    expect(cell.child(0).textContent).toBe("before");
    expect(cell.child(1).type.name).toBe("bullet_list");
    expect(cell.child(2).textContent).toBe("after");
  });

  it("preserves text after the marker on the same table cell line", () => {
    const testDoc = doc(table([tr([td("-test")])]));
    let triggerPosition = 0;
    testDoc.descendants((node, pos) => {
      if (node.isText && node.text === "-test") {
        triggerPosition = pos;
      }
    });
    const state = createEditorStateWithSelection(testDoc, triggerPosition + 1);
    const rule = listWrappingInputRule(
      /^\s*([-+*])\s$/,
      schema.nodes.bullet_list
    ) as ReturnType<typeof listWrappingInputRule> & InputRuleWithHandler;

    const transaction = rule.handler(
      state,
      ["- ", "-"] as unknown as RegExpMatchArray,
      triggerPosition,
      triggerPosition + 1
    );

    expect(transaction).not.toBeNull();

    const nextState = state.apply(transaction!);
    const listItem = nextState.doc
      .firstChild!.child(0)
      .child(0)
      .child(0)
      .child(0);

    expect(listItem.textContent).toBe("test");
    expect(nextState.selection.empty).toBe(true);
  });
});
