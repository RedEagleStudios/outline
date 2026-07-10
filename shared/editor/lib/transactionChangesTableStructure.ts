import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";

const tableStructureNodeTypes = new Set(["table", "tr", "td", "th"]);

/**
 * Checks whether a transaction changes table structure, rather than only table
 * content. Text edits inside cells can safely map existing table decorations.
 *
 * @param transaction the transaction to inspect.
 * @returns true if table, row, or cell structure may have changed.
 */
export function transactionChangesTableStructure(
  transaction: Transaction
): boolean {
  if (transaction.docs.length !== transaction.steps.length) {
    return true;
  }

  if (!transaction.docChanged) {
    return false;
  }

  for (let stepIndex = 0; stepIndex < transaction.steps.length; stepIndex++) {
    const step = transaction.steps[stepIndex];
    const stepDoc = transaction.docs[stepIndex];
    if (!step || !stepDoc) {
      return true;
    }

    const stepJSON = step.toJSON();
    if (
      containsTableStructureNode(stepJSON) ||
      attrStepChangesTableStructure(stepJSON, stepDoc)
    ) {
      return true;
    }

    let deletedTableStructure = false;
    step.getMap().forEach((oldStart, oldEnd) => {
      if (deletedTableStructure || oldStart === oldEnd) {
        return;
      }

      deletedTableStructure = rangeContainsDeletedTableStructure(
        stepDoc,
        oldStart,
        oldEnd
      );
    });

    if (deletedTableStructure) {
      return true;
    }
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

  if (
    !("stepType" in value) ||
    value.stepType !== "attr" ||
    !("pos" in value) ||
    typeof value.pos !== "number"
  ) {
    return false;
  }

  if (value.pos < 0 || value.pos > doc.content.size) {
    return true;
  }

  const node = doc.nodeAt(value.pos);
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
