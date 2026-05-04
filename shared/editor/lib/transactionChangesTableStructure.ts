import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

const tableStructureNodeTypes = new Set(["table", "tr", "td", "th"]);

/**
 * Checks whether a transaction changes table structure, rather than only table
 * content. Text edits inside cells can safely map existing table decorations.
 *
 * @param transaction the transaction to inspect.
 * @param oldState the editor state before the transaction.
 * @returns true if table, row, or cell structure may have changed.
 */
export function transactionChangesTableStructure(
  transaction: Transaction,
  oldState: EditorState
): boolean {
  if (!transaction.docChanged) {
    return false;
  }

  let currentDoc = oldState.doc;
  for (const step of transaction.steps) {
    const stepJSON = step.toJSON();
    if (
      containsTableStructureNode(stepJSON) ||
      attrStepChangesTableStructure(stepJSON, currentDoc)
    ) {
      return true;
    }

    const nextDoc = step.apply(currentDoc).doc;
    if (!nextDoc) {
      return true;
    }

    let deletedTableStructure = false;
    step.getMap().forEach((oldStart, oldEnd) => {
      if (deletedTableStructure || oldStart === oldEnd) {
        return;
      }

      deletedTableStructure = rangeContainsDeletedTableStructure(
        currentDoc,
        oldStart,
        oldEnd
      );
    });

    if (deletedTableStructure) {
      return true;
    }

    currentDoc = nextDoc;
  }

  return false;
}

function attrStepChangesTableStructure(
  value: unknown,
  doc: ProsemirrorNode
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const step = value as { stepType?: unknown; pos?: unknown };
  if (step.stepType !== "attr" || typeof step.pos !== "number") {
    return false;
  }

  const node = doc.nodeAt(step.pos);
  return node ? tableStructureNodeTypes.has(node.type.name) : false;
}

function containsTableStructureNode(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsTableStructureNode);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      key === "type" &&
      typeof child === "string" &&
      tableStructureNodeTypes.has(child)
    ) {
      return true;
    }

    if (containsTableStructureNode(child)) {
      return true;
    }
  }

  return false;
}

function rangeContainsDeletedTableStructure(
  doc: ProsemirrorNode,
  from: number,
  to: number
): boolean {
  let contains = false;

  doc.nodesBetween(from, to, (node, pos) => {
    if (contains) {
      return false;
    }

    const nodeEnd = pos + node.nodeSize;
    if (
      from <= pos &&
      nodeEnd <= to &&
      tableStructureNodeTypes.has(node.type.name)
    ) {
      contains = true;
      return false;
    }

    return true;
  });

  return contains;
}
