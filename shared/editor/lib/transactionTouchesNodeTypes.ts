import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

/**
 * Checks whether a transaction touches any nodes with the given type names.
 * Useful for avoiding full-document decoration rebuilds for unrelated text edits.
 *
 * @param transaction the transaction to inspect.
 * @param oldState the editor state before the transaction.
 * @param newState the editor state after the transaction.
 * @param nodeTypes node type names to check for.
 * @returns true if the transaction touches a matching node.
 */
export function transactionTouchesNodeTypes(
  transaction: Transaction,
  oldState: EditorState,
  _newState: EditorState,
  nodeTypes: ReadonlySet<string>
): boolean {
  if (!transaction.docChanged) {
    return false;
  }

  let currentDoc = oldState.doc;
  for (let index = 0; index < transaction.steps.length; index++) {
    const step = transaction.steps[index];
    const stepJSON = step.toJSON();
    if (
      containsNodeType(stepJSON, nodeTypes) ||
      attrStepTouchesNodeType(stepJSON, currentDoc, nodeTypes)
    ) {
      return true;
    }

    const nextDoc = step.apply(currentDoc).doc;
    if (!nextDoc) {
      return true;
    }

    let touchesNode = false;
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (touchesNode) {
        return;
      }

      touchesNode =
        rangeTouchesNodeType(currentDoc, oldStart, oldEnd, nodeTypes) ||
        rangeTouchesNodeType(nextDoc, newStart, newEnd, nodeTypes) ||
        positionHasAncestor(currentDoc, oldStart, nodeTypes) ||
        positionHasAncestor(currentDoc, oldEnd, nodeTypes) ||
        positionHasAncestor(nextDoc, newStart, nodeTypes) ||
        positionHasAncestor(nextDoc, newEnd, nodeTypes);
    });

    if (touchesNode) {
      return true;
    }

    currentDoc = nextDoc;
  }

  return false;
}

function attrStepTouchesNodeType(
  value: unknown,
  doc: ProsemirrorNode,
  nodeTypes: ReadonlySet<string>
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const step = value as { stepType?: unknown; pos?: unknown };
  if (step.stepType !== "attr" || typeof step.pos !== "number") {
    return false;
  }

  const node = doc.nodeAt(step.pos);
  return node ? nodeTypes.has(node.type.name) : false;
}

function containsNodeType(
  value: unknown,
  nodeTypes: ReadonlySet<string>
): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsNodeType(child, nodeTypes));
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "type" && typeof child === "string" && nodeTypes.has(child)) {
      return true;
    }

    if (containsNodeType(child, nodeTypes)) {
      return true;
    }
  }

  return false;
}

function rangeTouchesNodeType(
  doc: ProsemirrorNode,
  from: number,
  to: number,
  nodeTypes: ReadonlySet<string>
) {
  if (from === to) {
    return false;
  }

  let touches = false;
  doc.nodesBetween(from, to, (node) => {
    if (nodeTypes.has(node.type.name)) {
      touches = true;
      return false;
    }
    return true;
  });

  return touches;
}

function positionHasAncestor(
  doc: ProsemirrorNode,
  pos: number,
  nodeTypes: ReadonlySet<string>
) {
  const resolvedPos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let depth = resolvedPos.depth; depth > 0; depth--) {
    if (nodeTypes.has(resolvedPos.node(depth).type.name)) {
      return true;
    }
  }

  return false;
}
