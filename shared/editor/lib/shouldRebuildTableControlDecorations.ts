import type { EditorState, Transaction } from "prosemirror-state";
import { isInTable, selectedRect } from "prosemirror-tables";
import {
  isColSelection,
  isRowSelection,
  isTableSelected,
} from "../queries/table";
import { transactionChangesTableStructure } from "./transactionChangesTableStructure";

/**
 * Returns whether table control decorations need rebuilding for a transaction.
 * Normal text edits inside the same table can map existing controls instead.
 *
 * @param transaction the transaction to inspect.
 * @param oldState the editor state before the transaction.
 * @param newState the editor state after the transaction.
 * @returns true if row/column/table controls should be rebuilt.
 */
export function shouldRebuildTableControlDecorations(
  transaction: Transaction,
  oldState: EditorState,
  newState: EditorState
): boolean {
  if (transactionChangesTableStructure(transaction)) {
    return true;
  }

  const oldTableStart = getActiveTableStart(oldState);
  const newTableStart = getActiveTableStart(newState);
  if (oldTableStart !== newTableStart) {
    return true;
  }

  if (
    oldTableStart !== undefined &&
    transaction.mapping.map(oldTableStart) !== newTableStart
  ) {
    return true;
  }

  return hasTableSelection(oldState) || hasTableSelection(newState);
}

function getActiveTableStart(state: EditorState): number | undefined {
  if (!isInTable(state)) {
    return undefined;
  }

  return selectedRect(state).tableStart;
}

function hasTableSelection(state: EditorState): boolean {
  return (
    isTableSelected(state) || isRowSelection(state) || isColSelection(state)
  );
}
