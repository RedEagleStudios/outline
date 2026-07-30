import copy from "copy-to-clipboard";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import type {
  Node as ProsemirrorNode,
  NodeSpec,
  NodeType,
  Schema,
} from "prosemirror-model";
import type { Command, Transaction } from "prosemirror-state";
import { Plugin, PluginKey, Selection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { toast } from "sonner";
import type { Primitive } from "utility-types";
import { isSafari } from "../../utils/browser";
import Storage from "../../utils/Storage";
import backspaceToParagraph from "../commands/backspaceToParagraph";
import splitHeading from "../commands/splitHeading";
import toggleBlockType from "../commands/toggleBlockType";
import { headingToPersistenceKey } from "../lib/headingToSlug";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { transactionTouchesNodeTypes } from "../lib/transactionTouchesNodeTypes";
import { findCollapsedNodes } from "../queries/findCollapsedNodes";
import Node from "./Node";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";

const collapsedStorageValue = "collapsed";
const headingNodeTypes = new Set(["heading"]);

/** Browser-local state for collapsed heading sections. */
export interface HeadingFoldState {
  collapsedPositions: Set<number>;
  headingKeys: Map<number, string>;
  decorations: DecorationSet;
}

/** Plugin key for browser-local heading fold state. */
export const headingFoldPluginKey = new PluginKey<HeadingFoldState>(
  "headingFold"
);

/**
 * Adds a browser-local heading fold toggle to a transaction.
 *
 * @param transaction the transaction to annotate.
 * @param headingPosition the exact document position of the heading to toggle.
 * @returns the metadata-only transaction.
 */
export function toggleHeadingFold(
  transaction: Transaction,
  headingPosition: number
): Transaction {
  return transaction.setMeta(headingFoldPluginKey, headingPosition);
}

function buildHeadingKeys(
  doc: ProsemirrorNode,
  documentId: string | undefined
): Map<number, string> {
  const keys = new Map<number, string>();
  const slugCounts = new Map<string, number>();

  doc.descendants((node, position) => {
    if (node.type.name !== "heading") {
      return;
    }

    const baseKey = headingToPersistenceKey(node, documentId);
    const duplicateIndex = slugCounts.get(baseKey) ?? 0;
    slugCounts.set(baseKey, duplicateIndex + 1);
    keys.set(
      position,
      headingToPersistenceKey(node, documentId, duplicateIndex)
    );
  });

  return keys;
}

function topLevelStructureChanged(
  oldDoc: ProsemirrorNode,
  newDoc: ProsemirrorNode
): boolean {
  if (oldDoc.childCount !== newDoc.childCount) {
    return true;
  }

  for (let index = 0; index < oldDoc.childCount; index++) {
    if (oldDoc.child(index).type !== newDoc.child(index).type) {
      return true;
    }
  }

  return false;
}

/**
 * Creates the plugin that owns browser-local heading fold state.
 *
 * @param documentId the document identifier used in persistence keys.
 * @param createDecorations builds decorations from the current local state.
 * @returns a keyed ProseMirror plugin.
 */
export function createHeadingFoldPlugin(
  documentId: string | undefined,
  createDecorations: (
    doc: ProsemirrorNode,
    collapsedPositions: Set<number>,
    headingKeys: Map<number, string>
  ) => Decoration[]
): Plugin<HeadingFoldState> {
  const createState = (doc: ProsemirrorNode): HeadingFoldState => {
    const headingKeys = buildHeadingKeys(doc, documentId);
    const collapsedPositions = new Set<number>();
    headingKeys.forEach((key, position) => {
      if (Storage.get(key) === collapsedStorageValue) {
        collapsedPositions.add(position);
      }
    });

    return {
      collapsedPositions,
      headingKeys,
      decorations: DecorationSet.create(
        doc,
        createDecorations(doc, collapsedPositions, headingKeys)
      ),
    };
  };

  return new Plugin({
    key: headingFoldPluginKey,
    state: {
      init(_, { doc }) {
        return createState(doc);
      },
      apply(tr, value, oldState, newState) {
        const headingPosition = tr.getMeta(headingFoldPluginKey);
        if (typeof headingPosition === "number") {
          const collapsedPositions = new Set(value.collapsedPositions);
          const persistenceKey = value.headingKeys.get(headingPosition);
          if (!persistenceKey) {
            return value;
          }

          if (collapsedPositions.has(headingPosition)) {
            collapsedPositions.delete(headingPosition);
            Storage.remove(persistenceKey);
          } else {
            collapsedPositions.add(headingPosition);
            Storage.set(persistenceKey, collapsedStorageValue);
          }

          return {
            collapsedPositions,
            headingKeys: value.headingKeys,
            decorations: DecorationSet.create(
              tr.doc,
              createDecorations(tr.doc, collapsedPositions, value.headingKeys)
            ),
          };
        }

        if (!tr.docChanged) {
          return value;
        }

        const touchesHeadings = transactionTouchesNodeTypes(
          tr,
          oldState,
          newState,
          headingNodeTypes
        );
        if (!touchesHeadings) {
          const headingKeys = new Map<number, string>();
          const collapsedPositions = new Set<number>();
          value.headingKeys.forEach((key, position) => {
            const mapped = tr.mapping.mapResult(position, 1);
            if (
              !mapped.deleted &&
              tr.doc.nodeAt(mapped.pos)?.type.name === "heading"
            ) {
              headingKeys.set(mapped.pos, key);
              if (value.collapsedPositions.has(position)) {
                collapsedPositions.add(mapped.pos);
              }
            }
          });

          const structuralChange = topLevelStructureChanged(
            oldState.doc,
            tr.doc
          );
          return {
            collapsedPositions,
            headingKeys,
            decorations: structuralChange
              ? DecorationSet.create(
                  tr.doc,
                  createDecorations(tr.doc, collapsedPositions, headingKeys)
                )
              : value.decorations.map(tr.mapping, tr.doc),
          };
        }

        const headingKeys = buildHeadingKeys(tr.doc, documentId);
        const collapsedPositions = new Set<number>();
        const mappedOldHeadings = new Map<
          number,
          { key: string; collapsed: boolean }
        >();
        value.headingKeys.forEach((key, position) => {
          const mapped = tr.mapping.mapResult(position, 1);
          if (!mapped.deleted && headingKeys.has(mapped.pos)) {
            mappedOldHeadings.set(mapped.pos, {
              key,
              collapsed: value.collapsedPositions.has(position),
            });
          } else {
            Storage.remove(key);
          }
        });

        mappedOldHeadings.forEach(({ key }, position) => {
          if (headingKeys.get(position) !== key) {
            Storage.remove(key);
          }
        });
        mappedOldHeadings.forEach(({ collapsed }, position) => {
          const key = headingKeys.get(position);
          if (!key) {
            return;
          }

          if (!collapsed) {
            Storage.remove(key);
            return;
          }

          collapsedPositions.add(position);
          Storage.set(key, collapsedStorageValue);
        });
        headingKeys.forEach((key, position) => {
          if (
            !mappedOldHeadings.has(position) &&
            Storage.get(key) === collapsedStorageValue
          ) {
            collapsedPositions.add(position);
          }
        });

        return {
          collapsedPositions,
          headingKeys,
          decorations: DecorationSet.create(
            tr.doc,
            createDecorations(tr.doc, collapsedPositions, headingKeys)
          ),
        };
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorations;
      },
    },
  });
}

export enum HeadingLevel {
  One = 1,
  Two,
  Three,
  Four,
}

export default class Heading extends Node {
  get name() {
    return "heading";
  }

  get defaultOptions() {
    return {
      levels: [1, 2, 3, 4],
    };
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        level: {
          default: 1,
          validate: "number",
        },
      },
      content: "inline*",
      group: "block",
      defining: true,
      draggable: false,
      parseDOM: this.options.levels.map((level: number) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
      toDOM: (node) => [
        `h${node.attrs.level + (this.options.offset || 0)}`,
        {
          dir: "auto",
          class: "heading-content",
        },
        0,
      ],
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.write(state.repeat("#", node.attrs.level) + " ");
    state.renderInline(node);
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      block: "heading",
      getAttrs: (token: { tag: string }) => ({
        level: +token.tag.slice(1),
      }),
    };
  }

  commands({ type, schema }: { type: NodeType; schema: Schema }) {
    return (attrs: Record<string, Primitive>) =>
      toggleBlockType(type, schema.nodes.paragraph, attrs);
  }

  handleFoldContent = (event: MouseEvent) => {
    event.preventDefault();
    if (
      !(event.currentTarget instanceof HTMLButtonElement) ||
      event.button !== 0
    ) {
      return;
    }

    const { view } = this.editor;
    const hadFocus = view.hasFocus();
    const { tr } = view.state;
    const { top, left } = event.currentTarget.getBoundingClientRect();
    const result = view.posAtCoords({ top, left });

    if (result) {
      const node = view.state.doc.nodeAt(result.inside);

      if (node?.type.name === "heading") {
        const endOfHeadingPos = result.inside + node.nodeSize;
        const $pos = view.state.doc.resolve(endOfHeadingPos);
        const foldState = headingFoldPluginKey.getState(view.state);
        const collapsed = !foldState?.collapsedPositions.has(result.inside);
        let sectionEnd = view.state.doc.content.size;
        let foundSectionEnd = false;
        view.state.doc.nodesBetween(
          endOfHeadingPos,
          view.state.doc.content.size,
          (candidate, position) => {
            if (
              !foundSectionEnd &&
              candidate.type.name === "heading" &&
              candidate.attrs.level <= node.attrs.level
            ) {
              sectionEnd = position;
              foundSectionEnd = true;
              return false;
            }
            return !foundSectionEnd;
          }
        );

        if (
          collapsed &&
          view.state.selection.from < sectionEnd &&
          view.state.selection.to >= endOfHeadingPos
        ) {
          // move selection to the end of the collapsed heading
          tr.setSelection(Selection.near($pos, -1));
        }

        view.dispatch(toggleHeadingFold(tr, result.inside));

        if (hadFocus) {
          view.focus();
        }
      }
    }
  };

  handleCopyLink = (event: MouseEvent) => {
    if (!(event.currentTarget instanceof HTMLButtonElement)) {
      return;
    }

    const heading = event.currentTarget.closest(".heading-content");
    if (!heading) {
      return;
    }

    // Search previous siblings for the anchor element, as other elements
    // (e.g. multiplayer cursors) may be inserted between the anchor and heading.
    let anchor = heading.previousElementSibling;
    while (
      anchor &&
      !anchor.className?.includes(EditorStyleHelper.headingPositionAnchor)
    ) {
      anchor = anchor.previousElementSibling;
    }

    if (!anchor) {
      return;
    }

    const hash = `#${anchor.id}`;

    // the existing url might contain a hash already, lets make sure to remove
    // that rather than appending another one.
    const normalizedUrl = window.location.href
      .split("#")[0]
      .replace("/edit", "");
    copy(normalizedUrl + hash);

    toast.message(this.options.dictionary.linkCopied);
  };

  keys({ type, schema }: { type: NodeType; schema: Schema }) {
    const options = this.options.levels.reduce(
      (items: Record<string, Command>, level: number) => ({
        ...items,
        ...{
          [`Shift-Ctrl-${level}`]: toggleBlockType(
            type,
            schema.nodes.paragraph,
            { level }
          ),
        },
      }),
      {}
    );

    return {
      ...options,
      Backspace: backspaceToParagraph(type),
      Enter: splitHeading(
        type,
        (state, _heading, position) =>
          !!headingFoldPluginKey
            .getState(state)
            ?.collapsedPositions.has(position)
      ),
    };
  }

  get plugins() {
    const createDecorations = (
      doc: ProsemirrorNode,
      collapsedPositions: Set<number>
    ): Decoration[] => {
      const decorations: Decoration[] = [];

      doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          const collapsed = collapsedPositions.has(pos);

          // Create anchor button
          const anchor = document.createElement("button");
          anchor.innerText = "#";
          anchor.type = "button";
          anchor.className = "heading-anchor";
          anchor.setAttribute("aria-label", "Copy link to heading");
          anchor.addEventListener("mousedown", (event) =>
            this.handleCopyLink(event)
          );

          // Create fold button
          const fold = document.createElement("button");
          fold.innerText = "";
          fold.innerHTML =
            '<svg fill="currentColor" width="12" height="24" viewBox="6 0 12 24" xmlns="http://www.w3.org/2000/svg"><path d="M8.23823905,10.6097108 L11.207376,14.4695888 L11.207376,14.4695888 C11.54411,14.907343 12.1719566,14.989236 12.6097108,14.652502 C12.6783439,14.5997073 12.7398293,14.538222 12.792624,14.4695888 L15.761761,10.6097108 L15.761761,10.6097108 C16.0984949,10.1719566 16.0166019,9.54410997 15.5788477,9.20737601 C15.4040391,9.07290785 15.1896811,9 14.969137,9 L9.03086304,9 L9.03086304,9 C8.47857829,9 8.03086304,9.44771525 8.03086304,10 C8.03086304,10.2205442 8.10377089,10.4349022 8.23823905,10.6097108 Z" /></svg>';
          fold.type = "button";
          fold.className = `heading-fold ${collapsed ? "collapsed" : ""}`;
          fold.setAttribute(
            "aria-label",
            collapsed ? "Expand section" : "Collapse section"
          );
          fold.setAttribute("aria-expanded", (!collapsed).toString());
          fold.addEventListener("click", (event) =>
            this.handleFoldContent(event)
          );

          // Create container span
          const container = document.createElement("span");
          container.contentEditable = "false";
          container.className = `heading-actions ${
            collapsed ? "collapsed" : ""
          }`;
          container.appendChild(anchor);
          container.appendChild(fold);

          decorations.push(
            // Contains the heading actions
            Decoration.widget(
              // Safari requires the widget to be placed at the end of the node rather than the beginning
              // or caret selection is not correct, browser quirk – see issue #1234
              isSafari ? pos + node.nodeSize - 1 : pos + 1,
              container,
              {
                side: -1,
                ignoreSelection: true,
                relaxedSide: false,
                key: `${pos}-${collapsed ? "collapsed" : "expanded"}`,
              }
            )
          );

          // Creates a "space" for the caret to move to before the widget.
          // Without this it is very hard to place the caret at the beginning
          // of the heading when it begins with an atom element.
          if (node.firstChild?.isAtom === false) {
            decorations.push(
              Decoration.widget(pos + 1, () => document.createElement("span"), {
                side: -1,
                ignoreSelection: true,
                relaxedSide: true,
                key: "span",
              })
            );
          }
        }
      });

      findCollapsedNodes(doc, (_heading, position) =>
        collapsedPositions.has(position)
      ).forEach((block) => {
        decorations.push(
          Decoration.node(block.pos, block.pos + block.node.nodeSize, {
            class: "folded-content",
          })
        );
      });

      return decorations;
    };

    const foldPlugin = createHeadingFoldPlugin(
      this.editor.props.id,
      createDecorations
    );

    return [foldPlugin];
  }

  inputRules({ type }: { type: NodeType }) {
    return this.options.levels.map((level: number) =>
      textblockTypeInputRule(new RegExp(`^(#{1,${level}})\\s$`), type, () => ({
        level,
      }))
    );
  }
}
