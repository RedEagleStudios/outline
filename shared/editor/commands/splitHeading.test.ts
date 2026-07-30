import { TextSelection } from "prosemirror-state";
import { createEditorState, schema } from "@shared/test/editor";
import splitHeading from "./splitHeading";

describe("splitHeading", () => {
  it("does not apply custom collapsed behavior to a non-empty selection", () => {
    const heading = schema.nodes.heading.create(
      { level: 1 },
      schema.text("Selected")
    );
    const doc = schema.nodes.doc.create(null, [heading]);
    const initialState = createEditorState(doc);
    const state = initialState.apply(
      initialState.tr.setSelection(TextSelection.create(initialState.doc, 1, 3))
    );
    const dispatch = jest.fn();

    expect(
      splitHeading(schema.nodes.heading, () => true)(state, dispatch)
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
