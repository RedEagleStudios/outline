import type { Mark } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import {
  createEditorState,
  doc,
  extensionManager,
  schema,
} from "@shared/test/editor";
import TextColor from "./TextColor";
import TextSize from "./TextSize";

function elementWithAttribute(value: string | null): HTMLElement {
  return {
    getAttribute: () => value,
  } as unknown as HTMLElement;
}

function getAttrs(parser: unknown, value: string | null) {
  if (typeof parser !== "function") {
    return undefined;
  }

  return (
    parser as (node: HTMLElement) => false | Record<string, string | number>
  )(elementWithAttribute(value));
}

describe("text style marks", () => {
  it("registers text color and text size marks", () => {
    expect(schema.marks.text_color).toBeDefined();
    expect(schema.marks.text_size).toBeDefined();
  });

  it("renders text color attributes", () => {
    const mark = schema.marks.text_color.create({ color: "#336699" });
    const dom = new TextColor().schema.toDOM?.(mark as Mark, true);

    expect(dom).toEqual([
      "span",
      { "data-text-color": "#336699", style: "color: #336699" },
    ]);
  });

  it("parses valid text color and ignores invalid text color", () => {
    const styleParser = new TextColor().schema.parseDOM?.[1].getAttrs;

    expect(getAttrs(styleParser, "color: #336699")).toEqual({
      color: "#336699",
    });
    expect(getAttrs(styleParser, "color: red")).toBe(false);
  });

  it("removes text color when no color is provided", () => {
    const state = createEditorState(
      doc(
        schema.nodes.paragraph.create(null, [
          schema.text("Styled", [
            schema.marks.text_color.create({ color: "#336699" }),
          ]),
        ])
      )
    );
    const selectedState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 7))
    );
    let transaction = selectedState.tr;

    const handled = new TextColor().commands({
      type: schema.marks.text_color,
    })({ color: null })(selectedState, (tr) => {
      transaction = tr;
    });

    expect(handled).toBe(true);

    const nextState = selectedState.apply(transaction);
    expect(nextState.doc.firstChild?.firstChild?.marks).toEqual([]);
  });

  it("renders text size attributes", () => {
    const mark = schema.marks.text_size.create({ size: 24 });
    const dom = new TextSize().schema.toDOM?.(mark as Mark, true);

    expect(dom).toEqual([
      "span",
      { "data-text-size": 24, style: "font-size: 24px" },
    ]);
  });

  it("parses preset text size and ignores invalid text size", () => {
    const styleParser = new TextSize().schema.parseDOM?.[1].getAttrs;

    expect(getAttrs(styleParser, "font-size: 24px")).toEqual({
      size: 24,
    });
    expect(getAttrs(styleParser, "font-size: 13px")).toBe(false);
  });

  it("preserves nested text color and size through markdown", () => {
    const serializer = extensionManager.serializer();
    const parser = extensionManager.parser({ schema });
    const document = doc(
      schema.nodes.paragraph.create(null, [
        schema.text("Styled", [
          schema.marks.text_color.create({ color: "#336699" }),
          schema.marks.text_size.create({ size: 24 }),
        ]),
      ])
    );

    const markdown = serializer.serialize(document);
    const parsed = parser.parse(markdown);
    const text = parsed.firstChild?.firstChild;

    expect(markdown).toBe(
      '<span data-text-color="#336699" style="color: #336699"><span data-text-size="24" style="font-size: 24px">Styled</span></span>'
    );
    expect(text?.marks.map((mark) => mark.type.name)).toEqual([
      "text_color",
      "text_size",
    ]);
    expect(text?.marks[0].attrs.color).toBe("#336699");
    expect(text?.marks[1].attrs.size).toBe(24);
  });

  it("escapes styled markdown syntax content", () => {
    const serializer = extensionManager.serializer();
    const document = doc(
      schema.nodes.paragraph.create(null, [
        schema.text("*styled*", [
          schema.marks.text_color.create({ color: "#336699" }),
        ]),
      ])
    );

    expect(serializer.serialize(document)).toBe(
      '<span data-text-color="#336699" style="color: #336699">\\*styled\\*</span>'
    );
  });

  it("ignores invalid text style markdown spans", () => {
    const parser = extensionManager.parser({ schema });
    const parsed = parser.parse(
      '<span data-text-color="red" style="color: red">bad color</span> <span data-text-size="13" style="font-size: 13px">bad size</span>'
    );

    parsed.descendants((node) => {
      if (node.isText) {
        expect(node.marks).toHaveLength(0);
      }
    });
  });
});
