import type { Node as ProsemirrorNode } from "prosemirror-model";
import { schema } from "@shared/test/editor";
import { findCollapsedNodes } from "./findCollapsedNodes";

function heading(level: number, text: string): ProsemirrorNode {
  return schema.nodes.heading.create({ level }, schema.text(text));
}

function paragraph(text: string): ProsemirrorNode {
  return schema.nodes.paragraph.create(null, schema.text(text));
}

describe("findCollapsedNodes", () => {
  it("hides nested sections until a heading at the collapsed level", () => {
    const doc = schema.nodes.doc.create(null, [
      heading(1, "Collapsed"),
      paragraph("first hidden"),
      heading(2, "Nested"),
      paragraph("second hidden"),
      heading(1, "Visible"),
      paragraph("visible paragraph"),
    ]);

    const hidden = findCollapsedNodes(
      doc,
      (node) => node.textContent === "Collapsed"
    );

    expect(hidden.map(({ node }) => node.textContent)).toEqual([
      "first hidden",
      "Nested",
      "second hidden",
    ]);
  });

  it("uses the predicate for a nested collapsed section", () => {
    const doc = schema.nodes.doc.create(null, [
      heading(1, "Parent"),
      paragraph("visible before"),
      heading(2, "Collapsed nested"),
      paragraph("hidden child"),
      heading(3, "Hidden heading"),
      paragraph("hidden grandchild"),
      heading(2, "Visible sibling"),
    ]);

    const hidden = findCollapsedNodes(
      doc,
      (node) => node.textContent === "Collapsed nested"
    );

    expect(hidden.map(({ node }) => node.textContent)).toEqual([
      "hidden child",
      "Hidden heading",
      "hidden grandchild",
    ]);
  });

  it("resolves slug-equivalent headings by position", () => {
    const firstHeading = heading(1, "Duplicate");
    const firstParagraph = paragraph("visible");
    const secondPosition = firstHeading.nodeSize + firstParagraph.nodeSize;
    const doc = schema.nodes.doc.create(null, [
      firstHeading,
      firstParagraph,
      heading(1, "Duplicate"),
      paragraph("hidden only by second"),
    ]);

    const hidden = findCollapsedNodes(
      doc,
      (_node, position) => position === secondPosition
    );

    expect(hidden.map(({ node }) => node.textContent)).toEqual([
      "hidden only by second",
    ]);
  });
});
