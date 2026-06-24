import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import Extension from "../lib/Extension";

/**
 * GitHub Issue: https://github.com/outline/outline/issues/10681
 */
export default class DeleteNearAtom extends Extension {
  get name() {
    return "deleteNearAtom";
  }

  keys(): Record<string, Command> {
    return {
      Delete: deleteForwardNearAtom(),
      Backspace: deleteBackwardNearAtom(),
    };
  }
}

function isProtectedInlineNode(node: ProsemirrorNode | null | undefined) {
  return node?.isInline && (node.isAtom || node.type.name === "image");
}

/**
 * Delete nearby whitespace before falling back to default atom deletion.
 *
 * @returns the delete command.
 */
export function deleteForwardNearAtom(): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection)) {
      return false;
    }

    const { $cursor } = selection;
    if (!$cursor) {
      return false;
    }
    if ($cursor.textOffset !== 0) {
      return false;
    }

    const nodeBefore = $cursor.nodeBefore;
    const nodeAfter = $cursor.nodeAfter;

    if (isProtectedInlineNode(nodeBefore) && nodeAfter?.text?.startsWith(" ")) {
      dispatch?.(
        state.tr.delete($cursor.pos, $cursor.pos + 1).scrollIntoView()
      );
      return true;
    }

    if (!nodeAfter?.isText || nodeAfter.nodeSize !== 1) {
      return false;
    }

    const textEndPos = $cursor.pos + nodeAfter.nodeSize;
    if (textEndPos >= $cursor.end()) {
      return false;
    }

    const $afterText = state.doc.resolve(textEndPos);
    const nodeAfterText = $afterText.nodeAfter;

    if (isProtectedInlineNode(nodeAfterText)) {
      if (dispatch) {
        dispatch(
          state.tr.delete($cursor.pos, $cursor.pos + 1).scrollIntoView()
        );
      }
      return true;
    }

    return false;
  };
}

/**
 * Delete nearby whitespace before falling back to default atom deletion.
 *
 * @returns the backspace command.
 */
export function deleteBackwardNearAtom(): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!(selection instanceof TextSelection)) {
      return false;
    }

    const { $cursor } = selection;
    if (!$cursor) {
      return false;
    }

    const nodeBefore = $cursor.nodeBefore;
    const nodeAfter = $cursor.nodeAfter;

    if (nodeBefore?.isText && nodeBefore.text?.endsWith(" ")) {
      const textStartPos = $cursor.pos - nodeBefore.nodeSize;
      const $beforeText = state.doc.resolve(textStartPos);
      const nodeBeforeText = $beforeText.nodeBefore;

      if (isProtectedInlineNode(nodeBeforeText)) {
        dispatch?.(
          state.tr.delete($cursor.pos - 1, $cursor.pos).scrollIntoView()
        );
        return true;
      }
    }

    if (!nodeBefore?.isText || nodeBefore.nodeSize !== 1) {
      return false;
    }

    if (isProtectedInlineNode(nodeAfter)) {
      if (dispatch) {
        dispatch(
          state.tr.delete($cursor.pos - 1, $cursor.pos).scrollIntoView()
        );
      }
      return true;
    }

    return false;
  };
}
