import { wrappingInputRule, InputRule } from "prosemirror-inputrules";
import type {
  NodeType,
  Node as ProsemirrorNode,
  Attrs,
} from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { isInHeading } from "../queries/isInHeading";

/**
 * A wrapper for wrappingInputRule that prevents execution inside heading nodes.
 * This fixes the bug where typing list triggers ("* ", "- ", "1. ", etc.) inside
 * a heading would trigger list conversion.
 */
export function listWrappingInputRule(
  regexp: RegExp,
  nodeType: NodeType,
  getAttrs?: (match: RegExpMatchArray) => Attrs | null,
  joinPredicate?: (match: RegExpMatchArray, node: ProsemirrorNode) => boolean
): InputRule {
  const rule = wrappingInputRule(regexp, nodeType, getAttrs, joinPredicate);

  // Wrap the original rule to check if we're inside a heading
  return new InputRule(regexp, (state, match, start, end) => {
    // Don't apply the rule if we're inside a heading
    if (isInHeading(state)) {
      return null;
    }

    const { $from } = state.selection;
    const paragraphDepth = $from.depth;
    const paragraph = $from.node(paragraphDepth);

    let isInTableCell = false;
    for (let depth = paragraphDepth - 1; depth > 0; depth--) {
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
      // Otherwise, execute the original wrappingInputRule handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (rule as any).handler(state, match, start, end);
    }

    if (paragraph.type !== state.schema.nodes.paragraph) {
      return null;
    }

    const listItemType =
      nodeType.name === "checkbox_list"
        ? state.schema.nodes.checkbox_item
        : state.schema.nodes.list_item;

    if (!listItemType) {
      return null;
    }

    const paragraphStart = $from.before(paragraphDepth);
    const paragraphEnd = $from.after(paragraphDepth);
    const paragraphContentStart = paragraphStart + 1;
    const paragraphContentEnd = paragraphEnd - 1;

    let lineStart = paragraphContentStart;
    let lineEnd = paragraphContentEnd;

    paragraph.forEach((child, offset) => {
      if (child.type.name !== "br") {
        return;
      }

      const position = paragraphContentStart + offset;

      if (position < start) {
        lineStart = position + child.nodeSize;
      } else if (position >= end && lineEnd === paragraphContentEnd) {
        lineEnd = position;
      }
    });

    const lineStartOffset = lineStart - paragraphContentStart;
    const lineEndOffset = lineEnd - paragraphContentStart;
    const beforeEndOffset = lineStartOffset > 0 ? lineStartOffset - 1 : 0;
    const afterStartOffset =
      lineEndOffset < paragraph.content.size ? lineEndOffset + 1 : lineEndOffset;
    const nodes = [];

    if (beforeEndOffset > 0) {
      nodes.push(
        state.schema.nodes.paragraph.create(
          null,
          paragraph.content.cut(0, beforeEndOffset)
        )
      );
    }

    const attrs = getAttrs?.(match) ?? null;
    const listItemContent = paragraph.content.cut(
      end - paragraphContentStart,
      lineEndOffset
    );
    const list = nodeType.create(
      attrs,
      listItemType.create(
        null,
        state.schema.nodes.paragraph.create(
          null,
          listItemContent.size ? listItemContent : undefined
        )
      )
    );
    const listStart =
      paragraphStart + nodes.reduce((pos, node) => pos + node.nodeSize, 0);
    nodes.push(list);

    if (afterStartOffset < paragraph.content.size) {
      nodes.push(
        state.schema.nodes.paragraph.create(
          null,
          paragraph.content.cut(afterStartOffset)
        )
      );
    }

    const tr = state.tr.replaceWith(paragraphStart, paragraphEnd, nodes);

    return tr.setSelection(TextSelection.create(tr.doc, listStart + 3));
  });
}
