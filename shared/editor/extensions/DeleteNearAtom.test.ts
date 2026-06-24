import { TextSelection } from "prosemirror-state";
import { createEditorState, doc, schema } from "@shared/test/editor";
import {
  deleteBackwardNearAtom,
  deleteForwardNearAtom,
} from "./DeleteNearAtom";

function imageWithTextDocument(text: string) {
  return doc(
    schema.nodes.paragraph.create(null, [
      schema.nodes.image.create({ src: "https://example.com/image.png" }),
      schema.text(text),
    ])
  );
}

function getImagePosition(state: ReturnType<typeof createEditorState>) {
  let imagePosition = 0;

  state.doc.descendants((node, pos) => {
    if (node.type.name === "image") {
      imagePosition = pos;
      return false;
    }

    return true;
  });

  return imagePosition;
}

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

describe("deleteForwardNearAtom", () => {
  it("deletes whitespace after an image without deleting the image", () => {
    const state = createEditorState(imageWithTextDocument(" Text"));
    const imagePosition = getImagePosition(state);
    const textPosition = getTextPosition(state, " Text");
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, textPosition))
    );
    let transaction = selectedState.tr;

    const handled = deleteForwardNearAtom()(selectedState, (tr) => {
      transaction = tr;
    });

    expect(handled).toBe(true);

    const nextState = selectedState.apply(transaction);
    expect(nextState.doc.textContent).toBe("Text");
    expect(getImagePosition(nextState)).toBe(imagePosition);
  });
});

describe("deleteBackwardNearAtom", () => {
  it("deletes whitespace after an image without deleting the image", () => {
    const state = createEditorState(imageWithTextDocument(" Text"));
    const textPosition = getTextPosition(state, " Text");
    const imagePosition = getImagePosition(state);
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, textPosition + 1))
    );
    let transaction = selectedState.tr;

    const handled = deleteBackwardNearAtom()(selectedState, (tr) => {
      transaction = tr;
    });

    expect(handled).toBe(true);

    const nextState = selectedState.apply(transaction);
    expect(nextState.doc.textContent).toBe("Text");
    expect(getImagePosition(nextState)).toBe(imagePosition);
  });
});
