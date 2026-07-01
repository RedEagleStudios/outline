import { Plugin, PluginKey } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import Extension from "@shared/editor/lib/Extension";
import { isRemoteTransaction } from "@shared/editor/lib/multiplayer";
import { client } from "~/utils/ApiClient";
import Logger from "~/utils/Logger";

export interface TableCellHistoryContext {
  tableId: string;
  cellId: string;
  rowId: string | null;
  rowIndex: number | null;
  columnIndex: number | null;
}

interface CellSnapshot extends TableCellHistoryContext {
  text: string;
}

interface PendingCapture {
  documentId: string;
  tableId: string;
  cellId: string;
  rowId: string | null;
  oldText: string;
  newText: string;
  timeout: ReturnType<typeof setTimeout>;
}

const historyPluginKey = new PluginKey("table-cell-history");
const pendingCaptures = new Map<string, PendingCapture>();

function randomHistoryId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function isHistoryEnabled(editor: Extension["editor"]) {
  return (
    editor.props.tableEditHistoryEnabled === true &&
    !!editor.props.documentId &&
    !editor.props.readOnly
  );
}

function findCurrentCell(doc: ProsemirrorNode, pos: number) {
  const resolvedPos = doc.resolve(pos);
  for (let depth = resolvedPos.depth; depth > 0; depth--) {
    const node = resolvedPos.node(depth);
    if (node.type.name !== "td" && node.type.name !== "th") {
      continue;
    }

    let rowId: string | null = null;
    let tableId: string | null = null;
    let rowIndex: number | null = null;
    let columnIndex: number | null = null;
    for (let parentDepth = depth - 1; parentDepth > 0; parentDepth--) {
      const parent = resolvedPos.node(parentDepth);
      if (parent.type.name === "tr") {
        rowId = parent.attrs.rowId ?? null;
      }
      if (parent.type.name === "table") {
        tableId = parent.attrs.tableId ?? null;
        parent.forEach((row, _rowOffset, currentRowIndex) => {
          if (rowIndex !== null) {
            return;
          }

          row.forEach((cell, _cellOffset, currentColumnIndex) => {
            if (rowIndex !== null) {
              return;
            }

            if (cell === node || cell.attrs.cellId === node.attrs.cellId) {
              rowIndex = currentRowIndex;
              columnIndex = currentColumnIndex;
            }
          });
        });
        break;
      }
    }

    return {
      cell: node,
      cellPos: resolvedPos.before(depth),
      cellId: node.attrs.cellId ?? null,
      rowId,
      tableId,
      rowIndex,
      columnIndex,
    };
  }

  return undefined;
}

function collectCellIds(doc: ProsemirrorNode) {
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name !== "td" && node.type.name !== "th") {
      return true;
    }

    const cellId = node.attrs.cellId;
    if (typeof cellId !== "string") {
      return false;
    }
    if (ids.has(cellId)) {
      duplicates.add(cellId);
    }
    ids.add(cellId);
    return false;
  });

  return { ids, duplicates };
}

function getSingleChangedCell(
  oldDoc: ProsemirrorNode,
  newDoc: ProsemirrorNode
): { oldCell: CellSnapshot; newCell: CellSnapshot } | undefined {
  const { duplicates } = collectCellIds(newDoc);
  const oldCells = new Map<string, CellSnapshot>();
  const newCells = new Map<string, CellSnapshot>();

  function collect(doc: ProsemirrorNode, target: Map<string, CellSnapshot>) {
    doc.descendants((node, pos) => {
      if (node.type.name !== "td" && node.type.name !== "th") {
        return true;
      }
      const cellId = node.attrs.cellId;
      if (typeof cellId !== "string" || duplicates.has(cellId)) {
        return false;
      }

      const cell = findCurrentCell(doc, pos + 1);
      if (cell?.tableId && cell.cellId) {
        target.set(cell.cellId, {
          tableId: cell.tableId,
          cellId: cell.cellId,
          rowId: cell.rowId,
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          text: node.textContent,
        });
      }
      return false;
    });
  }

  collect(oldDoc, oldCells);
  collect(newDoc, newCells);

  const changed = [...newCells.values()].flatMap((newCell) => {
    const oldCell = oldCells.get(newCell.cellId);
    if (!oldCell || oldCell.text === newCell.text) {
      return [];
    }
    return [{ oldCell, newCell }];
  });

  return changed.length === 1 ? changed[0] : undefined;
}

function scheduleCapture(capture: Omit<PendingCapture, "timeout">) {
  const key = `${capture.documentId}:${capture.tableId}:${capture.cellId}`;
  const previous = pendingCaptures.get(key);
  if (previous) {
    clearTimeout(previous.timeout);
  }

  const timeout = setTimeout(() => {
    pendingCaptures.delete(key);
    void client
      .post("/tableHistory.capture", {
        documentId: capture.documentId,
        tableId: capture.tableId,
        cellId: capture.cellId,
        rowId: capture.rowId,
        oldText: previous?.oldText ?? capture.oldText,
        newText: capture.newText,
        clientMutationId: randomHistoryId("mutation"),
      })
      .catch((err) => {
        Logger.debug("editor", "Failed to capture table cell history", { err });
      });
  }, 1200);

  pendingCaptures.set(key, {
    ...capture,
    oldText: previous?.oldText ?? capture.oldText,
    timeout,
  });
}

function repairSelectedCellIds(tr: Transaction) {
  const cell = findCurrentCell(tr.doc, tr.selection.from);
  if (!cell) {
    return false;
  }

  const { duplicates } = collectCellIds(tr.doc);
  let repaired = false;

  if (cell.tableId === null) {
    const resolvedPos = tr.doc.resolve(tr.selection.from);
    for (let depth = resolvedPos.depth; depth > 0; depth--) {
      const node = resolvedPos.node(depth);
      if (node.type.name === "table") {
        tr.setNodeMarkup(resolvedPos.before(depth), undefined, {
          ...node.attrs,
          tableId: randomHistoryId("table"),
        });
        repaired = true;
        break;
      }
    }
  }

  if (cell.rowId === null) {
    const resolvedPos = tr.doc.resolve(tr.selection.from);
    for (let depth = resolvedPos.depth; depth > 0; depth--) {
      const node = resolvedPos.node(depth);
      if (node.type.name === "tr") {
        tr.setNodeMarkup(resolvedPos.before(depth), undefined, {
          ...node.attrs,
          rowId: randomHistoryId("row"),
        });
        repaired = true;
        break;
      }
    }
  }

  if (cell.cellId === null || duplicates.has(cell.cellId)) {
    tr.setNodeMarkup(cell.cellPos, undefined, {
      ...cell.cell.attrs,
      cellId: randomHistoryId("cell"),
    });
    repaired = true;
  }

  return repaired;
}

/**
 * Gets stable history identifiers for the selected table cell, if available.
 *
 * @param doc the ProseMirror document to inspect.
 * @param pos the selection position inside the current cell.
 * @returns the selected cell history context, if the cell has stable IDs.
 */
export function getSelectedTableCellHistoryContext(
  doc: ProsemirrorNode,
  pos: number
): TableCellHistoryContext | undefined {
  const cell = findCurrentCell(doc, pos);
  if (!cell?.tableId || !cell.cellId) {
    return undefined;
  }

  const { duplicates } = collectCellIds(doc);
  if (duplicates.has(cell.cellId)) {
    return undefined;
  }

  return {
    tableId: cell.tableId,
    cellId: cell.cellId,
    rowId: cell.rowId,
    rowIndex: cell.rowIndex,
    columnIndex: cell.columnIndex,
  };
}

/**
 * Ensures the selected table cell has stable history identifiers.
 *
 * @param view the editor view containing the selected table cell.
 * @returns the selected cell history context, if it can be established.
 */
export function ensureSelectedTableCellHistoryContext(
  view: EditorView
): TableCellHistoryContext | undefined {
  const tr = view.state.tr;
  const repaired = repairSelectedCellIds(tr);
  if (repaired) {
    tr.setMeta(historyPluginKey, { identityRepair: true });
    view.dispatch(tr);
    return getSelectedTableCellHistoryContext(tr.doc, tr.selection.from);
  }

  return getSelectedTableCellHistoryContext(
    view.state.doc,
    view.state.selection.from
  );
}

export default class TableCellHistoryExtension extends Extension {
  get name() {
    return "table-cell-history";
  }

  get plugins(): Plugin[] {
    return [
      new Plugin({
        key: historyPluginKey,
        appendTransaction: (transactions, oldState, newState) => {
          if (!isHistoryEnabled(this.editor)) {
            return null;
          }
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }
          if (transactions.some((tr) => tr.getMeta(historyPluginKey))) {
            return null;
          }
          if (transactions.some((tr) => isRemoteTransaction(tr))) {
            return null;
          }

          const tr = newState.tr;
          const repaired = repairSelectedCellIds(tr);
          if (repaired) {
            const documentId = this.editor.props.documentId;
            const oldCell = findCurrentCell(
              oldState.doc,
              oldState.selection.from
            );
            const newCell = findCurrentCell(tr.doc, tr.selection.from);
            if (
              documentId &&
              oldCell &&
              newCell?.tableId &&
              newCell.cellId &&
              oldCell.cell.textContent !== newCell.cell.textContent
            ) {
              scheduleCapture({
                documentId,
                tableId: newCell.tableId,
                cellId: newCell.cellId,
                rowId: newCell.rowId,
                oldText: oldCell.cell.textContent,
                newText: newCell.cell.textContent,
              });
            }
            tr.setMeta(historyPluginKey, { identityRepair: true });
            return tr;
          }

          const changedCell = getSingleChangedCell(oldState.doc, newState.doc);
          const documentId = this.editor.props.documentId;
          if (changedCell && documentId) {
            scheduleCapture({
              documentId,
              tableId: changedCell.newCell.tableId,
              cellId: changedCell.newCell.cellId,
              rowId: changedCell.newCell.rowId,
              oldText: changedCell.oldCell.text,
              newText: changedCell.newCell.text,
            });
          }

          return null;
        },
      }),
    ];
  }
}
