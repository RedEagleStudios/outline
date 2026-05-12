import type {
  NodeSpec,
  NodeType,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import {
  splitListItem,
  sinkListItem,
  liftListItem,
} from "prosemirror-schema-list";
import type { Transaction, EditorState, Command } from "prosemirror-state";
import { Plugin, TextSelection } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";
import { DecorationSet, Decoration } from "prosemirror-view";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { findParentNodeClosestToPos } from "../queries/findParentNode";
import { getParentListItem } from "../queries/getParentListItem";
import { isInList } from "../queries/isInList";
import { isList } from "../queries/isList";
import Node from "./Node";

function getSelectedListItemPositions(
  state: EditorState,
  type: NodeType
): number[] {
  const { from, to } = state.selection;
  const positions: number[] = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type !== type) {
      return true;
    }

    const firstChild = node.firstChild;

    if (!firstChild?.isTextblock) {
      return true;
    }

    const textFrom = pos + 2;
    const textTo = pos + 1 + firstChild.nodeSize;

    if (from < textTo && to > textFrom) {
      positions.push(pos);
    }

    return true;
  });

  return positions;
}

function moveSelectedListItems(
  type: NodeType,
  command: Command
): Command {
  return (state, dispatch) => {
    if (state.selection.empty) {
      return command(state, dispatch);
    }

    const positions = getSelectedListItemPositions(state, type);

    if (positions.length === 0) {
      return false;
    }

    if (!dispatch) {
      return positions.some((pos) => {
        const selection = TextSelection.near(state.doc.resolve(pos + 1));
        const selectedState = state.apply(state.tr.setSelection(selection));

        return command(selectedState);
      });
    }

    let currentState = state;
    const mapping = new Mapping();
    let handled = false;

    positions.forEach((pos) => {
      const mappedPos = mapping.map(pos, -1);
      const selection = TextSelection.near(
        currentState.doc.resolve(mappedPos + 1)
      );
      const selectedState = currentState.apply(
        currentState.tr.setSelection(selection)
      );

      command(selectedState, (tr) => {
        currentState = currentState.apply(tr);
        mapping.appendMapping(tr.mapping);
        dispatch(tr);
        handled = true;
      });
    });

    return handled;
  };
}

/**
 * Indents every list item touched by a non-empty selection.
 *
 * @param type - the list item node type.
 * @returns a ProseMirror command.
 */
export function indentSelectedListItems(type: NodeType): Command {
  return moveSelectedListItems(type, sinkListItem(type));
}

/**
 * Outdents every list item touched by a non-empty selection.
 *
 * @param type - the list item node type.
 * @returns a ProseMirror command.
 */
export function outdentSelectedListItems(type: NodeType): Command {
  return moveSelectedListItems(type, liftListItem(type));
}

/**
 * Removes an empty list item and promotes its nested child items one level.
 *
 * @param type - the list item node type.
 * @returns a ProseMirror command.
 */
export function promoteChildrenOfEmptyListItem(type: NodeType): Command {
  return (state, dispatch) => {
    if (!state.selection.empty) {
      return false;
    }

    const { $from } = state.selection;
    const paragraphDepth = $from.depth;
    const paragraph = $from.node(paragraphDepth);

    if (
      paragraph.type !== state.schema.nodes.paragraph ||
      paragraph.textContent !== "" ||
      $from.parentOffset !== 0
    ) {
      return false;
    }

    const listItemDepth = paragraphDepth - 1;

    if (listItemDepth < 0) {
      return false;
    }

    const listItem = $from.node(listItemDepth);

    if (listItem.type !== type || listItem.childCount !== 2) {
      return false;
    }

    const nestedList = listItem.child(1);

    if (!isList(nestedList, state.schema)) {
      return false;
    }

    if (nestedList.childCount === 0 || nestedList.child(0).type !== type) {
      return false;
    }

    const from = $from.before(listItemDepth);
    const to = $from.after(listItemDepth);
    const tr = state.tr.replaceWith(from, to, nestedList.content);

    tr.setSelection(
      TextSelection.near(tr.doc.resolve(from + 1))
    ).scrollIntoView();
    dispatch?.(tr);
    return true;
  };
}

/**
 * Handles Backspace in an empty list item before falling back to defaults.
 *
 * @param type - the list item node type.
 * @returns a ProseMirror command.
 */
export function backspaceEmptyListItem(type: NodeType): Command {
  return (state, dispatch) =>
    promoteChildrenOfEmptyListItem(type)(state, dispatch) ||
    backspaceEmptyOrderedListItem(type)(state, dispatch);
}

/**
 * Handles Backspace in an empty ordered list item by reducing its nesting level
 * or converting it to a paragraph at the root list level.
 *
 * @param type - the list item node type.
 * @returns a ProseMirror command.
 */
export function backspaceEmptyOrderedListItem(type: NodeType): Command {
  return (state, dispatch) => {
    if (!state.selection.empty) {
      return false;
    }

    const { $from } = state.selection;
    const paragraphDepth = $from.depth;
    const paragraph = $from.node(paragraphDepth);

    if (
      paragraph.type !== state.schema.nodes.paragraph ||
      paragraph.textContent !== "" ||
      $from.parentOffset !== 0
    ) {
      return false;
    }

    const listItemDepth = paragraphDepth - 1;
    const listDepth = paragraphDepth - 2;

    if (listItemDepth < 0 || listDepth < 0) {
      return false;
    }

    const listItem = $from.node(listItemDepth);
    const list = $from.node(listDepth);

    if (
      listItem.type !== type ||
      list.type !== state.schema.nodes.ordered_list
    ) {
      return false;
    }

    return liftListItem(type)(state, dispatch);
  };
}

export default class ListItem extends Node {
  get name() {
    return "list_item";
  }

  get schema(): NodeSpec {
    return {
      content: "block+",
      defining: true,
      draggable: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    };
  }

  get plugins() {
    return [
      new Plugin({
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply: (
            tr: Transaction,
            set: DecorationSet,
            oldState: EditorState,
            newState: EditorState
          ) => {
            const action = tr.getMeta("li");
            if (!action && !tr.docChanged) {
              return set;
            }

            // Adjust decoration positions to changes made by the transaction
            set = set.map(tr.mapping, tr.doc);

            switch (action?.event) {
              case "mouseover": {
                const result = findParentNodeClosestToPos(
                  newState.doc.resolve(action.pos),
                  (node) =>
                    node.type.name === this.name ||
                    node.type.name === "checkbox_item"
                );

                if (!result) {
                  return set;
                }

                const list = findParentNodeClosestToPos(
                  newState.doc.resolve(action.pos),
                  (node) => isList(node, this.editor.schema)
                );

                if (!list) {
                  return set;
                }

                const start = list.node.attrs.order || 1;

                let listItemNumber = 0;
                list.node.content.forEach((li, _, index) => {
                  if (li === result.node) {
                    listItemNumber = index;
                  }
                });

                const counterLength = String(start + listItemNumber).length;

                return set.add(tr.doc, [
                  Decoration.node(
                    result.pos,
                    result.pos + result.node.nodeSize,
                    {
                      class: `hovering`,
                    },
                    {
                      hover: true,
                    }
                  ),
                  Decoration.node(
                    result.pos,
                    result.pos + result.node.nodeSize,
                    {
                      class: `counter-${counterLength}`,
                    }
                  ),
                ]);
              }
              case "mouseout": {
                const result = findParentNodeClosestToPos(
                  newState.doc.resolve(action.pos),
                  (node) =>
                    node.type.name === this.name ||
                    node.type.name === "checkbox_item"
                );

                if (!result) {
                  return set;
                }

                return set.remove(
                  set.find(
                    result.pos,
                    result.pos + result.node.nodeSize,
                    (spec) => spec.hover
                  )
                );
              }
              default:
            }

            return set;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleKeyDown: (view, event) => {
            if (event.key !== "Backspace") {
              return false;
            }

            const { state, dispatch } = view;

            if (!state.selection.empty) {
              return false;
            }

            const { $from } = state.selection;
            const paragraphDepth = $from.depth;
            const paragraph = $from.node(paragraphDepth);

            if (
              paragraph.type !== state.schema.nodes.paragraph ||
              paragraph.textContent !== "" ||
              $from.parentOffset !== 0
            ) {
              return false;
            }

            const listItemDepth = paragraphDepth - 1;
            const listDepth = paragraphDepth - 2;
            const listItem = $from.node(listItemDepth);
            const list = $from.node(listDepth);

            if (!["list_item", "checkbox_item"].includes(listItem.type.name)) {
              return false;
            }

            if (
              promoteChildrenOfEmptyListItem(state.schema.nodes.list_item)(
                state,
                dispatch
              )
            ) {
              return true;
            }

            if (list.type === state.schema.nodes.ordered_list) {
              return backspaceEmptyOrderedListItem(state.schema.nodes.list_item)(
                state,
                dispatch
              );
            }

            if (list.childCount !== 1) {
              return false;
            }

            let isInTableCell = false;
            for (let depth = listDepth - 1; depth > 0; depth--) {
              const node = $from.node(depth);

              if (
                node.type.spec.tableRole === "cell" ||
                node.type.spec.tableRole === "header_cell"
              ) {
                isInTableCell = true;
                break;
              }
            }

            if (!isInTableCell) {
              return false;
            }

            const marker = list.type.name === "ordered_list" ? "1. " : "- ";
            const listStart = $from.before(listDepth);
            const listEnd = $from.after(listDepth);
            const replacement = state.schema.nodes.paragraph.create(
              null,
              state.schema.text(marker)
            );
            const tr = state.tr.replaceWith(listStart, listEnd, replacement);

            dispatch(
              tr.setSelection(
                TextSelection.create(tr.doc, listStart + 1 + marker.length)
              )
            );

            return true;
          },
          handleDOMEvents: {
            mouseover: (view, event) => {
              if (!view.editable) {
                return false;
              }
              const { state, dispatch } = view;
              const target = event.target as HTMLElement;
              const li = target?.closest("li");

              if (!li) {
                return false;
              }
              if (!view.dom.contains(li)) {
                return false;
              }
              const pos = view.posAtDOM(li, 0);
              if (!pos) {
                return false;
              }

              dispatch(
                state.tr.setMeta("li", {
                  event: "mouseover",
                  pos,
                })
              );
              return false;
            },
            mouseout: (view, event) => {
              if (!view.editable) {
                return false;
              }
              const { state, dispatch } = view;
              const target = event.target as HTMLElement;
              const li = target?.closest("li");

              if (!li) {
                return false;
              }
              if (!view.dom.contains(li)) {
                return false;
              }
              const pos = view.posAtDOM(li, 0);
              if (!pos) {
                return false;
              }

              dispatch(
                state.tr.setMeta("li", {
                  event: "mouseout",
                  pos,
                })
              );
              return false;
            },
          },
        },
      }),
    ];
  }

  commands({ type }: { type: NodeType }) {
    return {
      indentList: () => indentSelectedListItems(type),
      outdentList: () => outdentSelectedListItems(type),
    };
  }

  keys({ type }: { type: NodeType }): Record<string, Command> {
    return {
      Enter: splitListItem(type),
      Backspace: backspaceEmptyListItem(type),
      Tab: indentSelectedListItems(type),
      "Shift-Tab": outdentSelectedListItems(type),
      "Mod-]": indentSelectedListItems(type),
      "Mod-[": outdentSelectedListItems(type),
      "Shift-Enter": (state, dispatch) => {
        if (!isInList(state)) {
          return false;
        }
        if (!state.selection.empty) {
          return false;
        }

        const { tr, selection } = state;
        dispatch?.(tr.split(selection.to));
        return true;
      },
      "Alt-ArrowUp": (state, dispatch) => {
        if (!state.selection.empty) {
          return false;
        }
        const result = getParentListItem(state);
        if (!result) {
          return false;
        }

        const [li, pos] = result;
        const $pos = state.doc.resolve(pos);

        if (
          !$pos.nodeBefore ||
          !["list_item", "checkbox_item"].includes($pos.nodeBefore.type.name)
        ) {
          return false;
        }

        const { tr } = state;
        const newPos = pos - $pos.nodeBefore.nodeSize;

        dispatch?.(
          tr
            .delete(pos, pos + li.nodeSize)
            .insert(newPos, li)
            .setSelection(TextSelection.near(tr.doc.resolve(newPos)))
        );
        return true;
      },
      "Alt-ArrowDown": (state, dispatch) => {
        if (!state.selection.empty) {
          return false;
        }
        const result = getParentListItem(state);
        if (!result) {
          return false;
        }

        const [li, pos] = result;
        const $pos = state.doc.resolve(pos + li.nodeSize);

        if (
          !$pos.nodeAfter ||
          !["list_item", "checkbox_item"].includes($pos.nodeAfter.type.name)
        ) {
          return false;
        }

        const { tr } = state;
        const newPos = pos + li.nodeSize + $pos.nodeAfter.nodeSize;

        dispatch?.(
          tr
            .insert(newPos, li)
            .setSelection(TextSelection.near(tr.doc.resolve(newPos)))
            .delete(pos, pos + li.nodeSize)
        );
        return true;
      },
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    if (state.inTable) {
      node.forEach((block, _, i) => {
        if (i > 0) {
          state.out += " ";
        }
        state.renderInline(block);
      });
      return;
    }
    state.renderContent(node);
  }

  parseMarkdown() {
    return { block: "list_item" };
  }
}
