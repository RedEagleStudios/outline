import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Decoration } from "prosemirror-view";
import { createEditorState, schema } from "@shared/test/editor";
import Storage from "../../utils/Storage";
import { headingToPersistenceKey } from "../lib/headingToSlug";
import { findCollapsedNodes } from "../queries/findCollapsedNodes";
import {
  createHeadingFoldPlugin,
  headingFoldPluginKey,
  toggleHeadingFold,
} from "./Heading";

const documentId = "heading-fold-test";
const storageKeys = new Set<string>();

function heading(text: string, level = 1): ProsemirrorNode {
  return schema.nodes.heading.create({ level }, schema.text(text));
}

function persistenceKey(node: ProsemirrorNode, index = 0): string {
  const key = headingToPersistenceKey(node, documentId, index);
  storageKeys.add(key);
  return key;
}

function createPlugin() {
  return createHeadingFoldPlugin(documentId, (currentDoc, collapsedPositions) =>
    findCollapsedNodes(currentDoc, (_node, position) =>
      collapsedPositions.has(position)
    ).map((block) =>
      Decoration.node(block.pos, block.pos + block.node.nodeSize, {
        class: "folded-content",
      })
    )
  );
}

describe("heading fold plugin", () => {
  afterEach(() => {
    storageKeys.forEach((key) => Storage.remove(key));
    storageKeys.clear();
  });

  it("toggles local decorations with a metadata-only transaction", () => {
    const foldedHeading = heading("Local only");
    const key = persistenceKey(foldedHeading);
    const doc = schema.nodes.doc.create(null, [
      foldedHeading,
      schema.nodes.paragraph.create(null, schema.text("section content")),
    ]);
    const state = createEditorState(doc, [createPlugin()]);

    expect(headingFoldPluginKey.getState(state)?.collapsedPositions.size).toBe(
      0
    );
    const transaction = toggleHeadingFold(state.tr, 0);
    expect(transaction.docChanged).toBe(false);

    const collapsedState = state.apply(transaction);
    const foldState = headingFoldPluginKey.getState(collapsedState);
    expect(foldState?.collapsedPositions.has(0)).toBe(true);
    expect(foldState?.decorations.find()).toHaveLength(1);
    expect(Storage.get(key)).toBe("collapsed");

    const remotelyUpdatedState = collapsedState.apply(
      collapsedState.tr.insert(
        collapsedState.doc.content.size,
        schema.nodes.paragraph.create(null, schema.text("remote content"))
      )
    );
    expect(
      headingFoldPluginKey.getState(remotelyUpdatedState)?.decorations.find()
    ).toHaveLength(2);

    const expandedState = remotelyUpdatedState.apply(
      toggleHeadingFold(remotelyUpdatedState.tr, 0)
    );
    expect(
      headingFoldPluginKey.getState(expandedState)?.collapsedPositions.size
    ).toBe(0);
    expect(
      headingFoldPluginKey.getState(expandedState)?.decorations.find()
    ).toHaveLength(0);
    expect(Storage.get(key)).toBeUndefined();
  });

  it("assigns duplicate headings distinct keys and folds them independently", () => {
    const duplicate = heading("Same title");
    const secondPosition = duplicate.nodeSize;
    const firstKey = persistenceKey(duplicate);
    const secondKey = persistenceKey(duplicate, 1);
    const doc = schema.nodes.doc.create(null, [duplicate, duplicate]);
    const state = createEditorState(doc, [createPlugin()]);
    const initialFoldState = headingFoldPluginKey.getState(state);

    expect(initialFoldState?.headingKeys.get(0)).toBe(firstKey);
    expect(initialFoldState?.headingKeys.get(secondPosition)).toBe(secondKey);
    expect(firstKey).not.toBe(secondKey);

    const collapsedState = state.apply(
      toggleHeadingFold(state.tr, secondPosition)
    );
    const foldState = headingFoldPluginKey.getState(collapsedState);
    expect(foldState?.collapsedPositions.has(0)).toBe(false);
    expect(foldState?.collapsedPositions.has(secondPosition)).toBe(true);
    expect(Storage.get(firstKey)).toBeUndefined();
    expect(Storage.get(secondKey)).toBe("collapsed");
  });

  it("preserves and migrates collapse state through a heading title edit", () => {
    const original = heading("Original");
    const originalKey = persistenceKey(original);
    const renamedKey = persistenceKey(heading("Renamed"));
    const doc = schema.nodes.doc.create(null, [
      original,
      schema.nodes.paragraph.create(null, schema.text("hidden")),
    ]);
    const state = createEditorState(doc, [createPlugin()]);
    const collapsedState = state.apply(toggleHeadingFold(state.tr, 0));
    const renamedState = collapsedState.apply(
      collapsedState.tr.replaceWith(
        1,
        original.nodeSize - 1,
        schema.text("Renamed")
      )
    );
    const foldState = headingFoldPluginKey.getState(renamedState);

    expect(foldState?.collapsedPositions.has(0)).toBe(true);
    expect(foldState?.headingKeys.get(0)).toBe(renamedKey);
    expect(Storage.get(originalKey)).toBeUndefined();
    expect(Storage.get(renamedKey)).toBe("collapsed");
  });

  it("restores collapse state from browser storage in a fresh state", () => {
    const foldedHeading = heading("Restored");
    const key = persistenceKey(foldedHeading);
    Storage.set(key, "collapsed");
    const doc = schema.nodes.doc.create(null, [
      foldedHeading,
      schema.nodes.paragraph.create(null, schema.text("hidden")),
    ]);

    const state = createEditorState(doc, [createPlugin()]);
    expect(
      headingFoldPluginKey.getState(state)?.collapsedPositions.has(0)
    ).toBe(true);
    expect(
      headingFoldPluginKey.getState(state)?.decorations.find()
    ).toHaveLength(1);
  });

  it("does not transfer an existing duplicate's state to one inserted before it", () => {
    const duplicate = heading("Duplicate");
    const firstKey = persistenceKey(duplicate);
    const secondKey = persistenceKey(duplicate, 1);
    const doc = schema.nodes.doc.create(null, [duplicate]);
    const state = createEditorState(doc, [createPlugin()]);
    const collapsedState = state.apply(toggleHeadingFold(state.tr, 0));
    const insertedState = collapsedState.apply(
      collapsedState.tr.insert(0, duplicate)
    );
    const existingPosition = duplicate.nodeSize;
    const foldState = headingFoldPluginKey.getState(insertedState);

    expect(foldState?.collapsedPositions.has(0)).toBe(false);
    expect(foldState?.collapsedPositions.has(existingPosition)).toBe(true);
    expect(foldState?.headingKeys.get(0)).toBe(firstKey);
    expect(foldState?.headingKeys.get(existingPosition)).toBe(secondKey);
    expect(Storage.get(firstKey)).toBeUndefined();
    expect(Storage.get(secondKey)).toBe("collapsed");
  });

  it("drops a legacy collapsed attribute while loading JSON", () => {
    const legacy = schema.nodeFromJSON({
      type: "heading",
      attrs: { level: 2, collapsed: true },
      content: [{ type: "text", text: "Legacy" }],
    });

    expect(legacy.toJSON()).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Legacy" }],
    });
  });

  it("defaults legacy server-side collapse state to expanded", () => {
    const legacyHeading = schema.nodeFromJSON({
      type: "heading",
      attrs: { level: 1, collapsed: true },
      content: [{ type: "text", text: "Server collapsed" }],
    });
    const key = persistenceKey(legacyHeading);
    const doc = schema.nodes.doc.create(null, [
      legacyHeading,
      schema.nodes.paragraph.create(null, schema.text("visible content")),
    ]);

    const state = createEditorState(doc, [createPlugin()]);
    const foldState = headingFoldPluginKey.getState(state);

    expect(foldState?.collapsedPositions.size).toBe(0);
    expect(foldState?.decorations.find()).toHaveLength(0);
    expect(Storage.get(key)).toBeUndefined();
  });
});
