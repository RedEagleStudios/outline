import { createHash } from "crypto";
import { JSDOM } from "jsdom";
import { Node, Fragment, type NodeType } from "prosemirror-model";
import ukkonen from "ukkonen";
import { updateYFragment, yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import {
  ChangesetHelper,
  type ExtendedChange,
} from "@shared/editor/lib/ChangesetHelper";
import textBetween from "@shared/editor/lib/textBetween";
import { EditorStyleHelper } from "@shared/editor/styles/EditorStyleHelper";
import { TableLayout } from "@shared/editor/types";
import type { NavigationNode, ProsemirrorData } from "@shared/types";
import { IconType, TextEditMode } from "@shared/types";
import { determineIconType } from "@shared/utils/icon";
import { parser, serializer, schema } from "@server/editor";
import { FindTextNotFoundError, ValidationError } from "@server/errors";
import { addTags } from "@server/logging/tracer";
import { trace } from "@server/logging/tracing";
import type { Template } from "@server/models";
import { Collection, Document, Revision } from "@server/models";
import type { MentionAttrs } from "./ProsemirrorHelper";
import { ProsemirrorHelper } from "./ProsemirrorHelper";
import { TextHelper } from "./TextHelper";

/** Maps a range of text-content offsets to ProseMirror Fragment offsets. */
interface InlineSegment {
  textFrom: number;
  textTo: number;
  pmFrom: number;
  pmTo: number;
  /** Whether this segment is an atom node whose text length differs from nodeSize. */
  isAtom?: boolean;
}

/** Context for a patch operation, shared across surgical patch methods. */
interface PatchContext {
  /** The full document markdown string. */
  markdown: string;
  /** Start of the findText match in the markdown. */
  matchIndex: number;
  /** End of the findText match in the markdown. */
  matchEnd: number;
  /** Start of the target node's markdown in the full string. */
  nodeMdFrom: number;
  /** End of the target node's markdown in the full string. */
  nodeMdTo: number;
  /** The markdown replacement text. */
  replacementText: string;
}

/** Information about a single top-level block node in a document. */
export interface BlockInfo {
  /** Zero-based positional index of the block among top-level children. */
  index: number;
  /** ProseMirror node type name, e.g. "paragraph", "heading", "bullet_list". */
  type: string;
  /** Plain-text content of the block. */
  textContent: string;
  /** Node attrs map. */
  attrs: Record<string, unknown>;
  /** 8-char hex MD5 of the block's ProseMirror JSON, for optimistic concurrency. */
  contentHash: string;
  /** Full ProseMirror JSON for the block node. */
  data: Record<string, unknown>;
}

type HTMLOptions = {
  /** Whether to include the document title in the generated HTML (defaults to true) */
  includeTitle?: boolean;
  /** Whether to include style tags in the generated HTML (defaults to true) */
  includeStyles?: boolean;
  /** Whether to include the Mermaid script in the generated HTML (defaults to false) */
  includeMermaid?: boolean;
  /** Whether to include the doctype,head, etc in the generated HTML (defaults to false) */
  includeHead?: boolean;
  /** Whether to include styles to center diff (defaults to true) */
  centered?: boolean;
  /**
   * Whether to replace attachment urls with pre-signed versions. If set to a
   * number then the urls will be signed for that many seconds. (defaults to false)
   */
  signedUrls?: boolean | number;
  /** The base URL to use for relative links */
  baseUrl?: string;
  /** Changes to highlight in the document */
  changes?: readonly ExtendedChange[];
  /** CSP nonce to apply to injected inline scripts */
  cspNonce?: string;
};

@trace()
export class DocumentHelper {
  /**
   * Returns the document as a Prosemirror Node. This method uses the derived content if available
   * then the collaborative state, otherwise it falls back to Markdown.
   *
   * @param document The document or revision to convert
   * @returns The document content as a Prosemirror Node
   */
  static toProsemirror(
    document: Document | Revision | Collection | ProsemirrorData
  ) {
    if ("type" in document && document.type === "doc") {
      return Node.fromJSON(schema, document);
    }
    if ("content" in document && document.content) {
      return Node.fromJSON(schema, document.content);
    }
    if ("state" in document && document.state) {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, document.state);
      return Node.fromJSON(schema, yDocToProsemirrorJSON(ydoc, "default"));
    }

    const text =
      document instanceof Collection ? document.description : document.text;
    return parser.parse(text ?? "") || Node.fromJSON(schema, {});
  }

  /**
   * Returns the document as a plain JSON object. This method uses the derived content if available
   * then the collaborative state, otherwise it falls back to Markdown.
   *
   * @param document The document or revision to convert
   * @param options Options for the conversion
   * @returns The document content as a plain JSON object
   */
  static async toJSON(
    document: Document | Revision | Collection | Template,
    options?: {
      /** The team context */
      teamId?: string;
      /** Whether to sign attachment urls, and if so for how many seconds is the signature valid */
      signedUrls?: number;
      /** Marks to remove from the document */
      removeMarks?: string[];
      /** The base path to use for internal links (will replace /doc/) */
      internalUrlBase?: string;
    }
  ): Promise<ProsemirrorData> {
    let doc: Node | null;
    let data;

    if ("content" in document && document.content) {
      // Optimized path for documents with content available and no transformation required.
      if (
        !options?.removeMarks &&
        !options?.signedUrls &&
        !options?.internalUrlBase
      ) {
        return document.content;
      }
      doc = Node.fromJSON(schema, document.content);
    } else if ("state" in document && document.state) {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, document.state);
      doc = Node.fromJSON(schema, yDocToProsemirrorJSON(ydoc, "default"));
    } else if (document instanceof Collection) {
      doc = parser.parse(document.description ?? "");
    } else {
      doc = parser.parse("text" in document ? (document.text ?? "") : "");
    }

    if (doc && options?.signedUrls && options?.teamId) {
      data = await ProsemirrorHelper.signAttachmentUrls(
        doc,
        options.teamId,
        options.signedUrls
      );
    } else {
      data = doc?.toJSON() ?? {};
    }

    if (options?.internalUrlBase) {
      data = ProsemirrorHelper.replaceInternalUrls(
        data,
        options.internalUrlBase
      );
    }
    if (options?.removeMarks) {
      data = ProsemirrorHelper.removeMarks(data, options.removeMarks);
    }

    return data;
  }

  /**
   * Normalizes smart (curly) quotes in a markdown string to their straight-quote
   * equivalents. This is applied on both the export path (`toMarkdown`) and the
   * patch path (`applyMarkdownToDocument`) so that `findText` lookups are
   * deterministic regardless of which path produced the markdown.
   *
   * Only 1:1 character substitutions are performed so that position offsets
   * produced by `serializeWithPositions` remain valid after normalization.
   * The `\` newline replacement (which changes string length) must NOT be
   * included here; it stays in `toMarkdown` only.
   *
   * @param text The markdown string to normalize.
   * @returns The markdown string with smart quotes replaced by straight quotes.
   */
  static normalizeMarkdown(text: string): string {
    return text
      .replace(/\u201C/g, '"')
      .replace(/\u201D/g, '"')
      .replace(/\u2018/g, "'")
      .replace(/\u2019/g, "'");
  }

  /**
   * Returns the document as plain text. This method uses the
   * collaborative state if available, otherwise it falls back to Markdown.
   *
   * @param document The document or revision or prosemirror data to convert
   * @returns The document content as plain text without formatting.
   */
  static toPlainText(document: Document | Revision | ProsemirrorData) {
    const node = DocumentHelper.toProsemirror(document);
    return textBetween(node, 0, node.content.size);
  }

  /**
   * Returns the document as Markdown. This is a lossy conversion and should only be used for export.
   *
   * @param document The document or revision to convert
   * @param options Options for the conversion
   * @returns The document title and content as a Markdown string
   */
  static async toMarkdown(
    document: Document | Revision | Collection | ProsemirrorData,
    options?: {
      /** Whether to include the document title (default: true) */
      includeTitle?: boolean;
      /** Whether to sign attachment urls, and if so for how many seconds is the signature valid */
      signedUrls?: number;
      /** The team context */
      teamId?: string;
      /**
       * When true, smart (curly) quotes are NOT normalized to straight quotes in the
       * serialized output. Useful for agents performing exact-byte round-trips that
       * need to preserve the original quote characters.
       */
      disableSmartTypography?: boolean;
    }
  ) {
    let node = DocumentHelper.toProsemirror(document);

    if (options?.signedUrls && options?.teamId) {
      const data = await ProsemirrorHelper.signAttachmentUrls(
        node,
        options.teamId,
        options.signedUrls
      );
      node = Node.fromJSON(schema, data);
    }

    const serialized = serializer
      .serialize(node)
      .replace(/(^|\n)\\(\n|$)/g, "\n\n");

    const text = (
      options?.disableSmartTypography
        ? serialized
        : DocumentHelper.normalizeMarkdown(serialized)
    ).trim();

    if (
      (document instanceof Collection ||
        document instanceof Document ||
        document instanceof Revision) &&
      options?.includeTitle !== false
    ) {
      const iconType = determineIconType(document.icon);
      const name =
        document instanceof Collection ? document.name : document.title;
      const title = `${iconType === IconType.Emoji ? document.icon + " " : ""}${name}`;
      return `# ${title}\n\n${text}`;
    }

    return text;
  }

  /**
   * Returns the document as plain HTML. This is a lossy conversion and should only be used for export.
   *
   * @param model The document or revision or collection to convert
   * @param options Options for the HTML output
   * @returns The document title and content as a HTML string
   */
  static async toHTML(
    model: Document | Revision | Collection,
    options?: HTMLOptions
  ) {
    const node = DocumentHelper.toProsemirror(model);
    let output = ProsemirrorHelper.toHTML(node, {
      title:
        options?.includeTitle !== false
          ? model instanceof Collection
            ? model.name
            : model.title
          : undefined,
      includeStyles: options?.includeStyles,
      includeMermaid: options?.includeMermaid,
      includeHead: options?.includeHead,
      centered: options?.centered,
      baseUrl: options?.baseUrl,
      changes: options?.changes,
      cspNonce: options?.cspNonce,
    });

    addTags({
      collectionId: model instanceof Collection ? model.id : undefined,
      documentId: !(model instanceof Collection) ? model.id : undefined,
    });

    if (options?.signedUrls) {
      const teamId =
        model instanceof Collection || model instanceof Document
          ? model.teamId
          : (await model.$get("document"))?.teamId;

      if (!teamId) {
        return output;
      }

      output = await TextHelper.attachmentsToSignedUrls(
        output,
        teamId,
        typeof options.signedUrls === "number" ? options.signedUrls : undefined
      );
    }

    return output;
  }

  /**
   * Parse a list of mentions contained in a document or revision
   *
   * @param document Document or Revision
   * @param options Attributes to use for filtering mentions
   * @returns An array of mentions in passed document or revision
   */
  static parseMentions(
    document: Document | Revision,
    options?: Partial<MentionAttrs>
  ) {
    const node = DocumentHelper.toProsemirror(document);
    return ProsemirrorHelper.parseMentions(node, options);
  }

  /**
   * Parse a list of document IDs contained in a document or revision
   *
   * @param document Document or Revision
   * @returns An array of identifiers in passed document or revision
   */
  static parseDocumentIds(document: Document | Revision) {
    const node = DocumentHelper.toProsemirror(document);
    return ProsemirrorHelper.parseDocumentIds(node);
  }

  /**
   * Generates a HTML diff between documents or revisions.
   *
   * @param before The before document
   * @param after The after document
   * @param options Options passed to HTML generation
   * @returns The diff as a HTML string
   */
  static async diff(
    before: Document | Revision | null,
    after: Revision,
    options: HTMLOptions = {}
  ) {
    addTags({
      beforeId: before?.id,
      documentId: after.documentId,
      options,
    });

    if (!before) {
      return await DocumentHelper.toHTML(after, options);
    }

    const beforeJSON = await DocumentHelper.toJSON(before);
    const afterJSON = await DocumentHelper.toJSON(after);
    const changeset = ChangesetHelper.getChangeset(afterJSON, beforeJSON);

    return DocumentHelper.toHTML(after, {
      ...options,
      changes: changeset ? changeset.changes : undefined,
    });
  }

  /**
   * Generates a compact HTML diff between documents or revisions, the
   * diff is reduced up to show only the parts of the document that changed and
   * the immediate context. Breaks in the diff are denoted with
   * "div.diff-context-break" nodes.
   *
   * @param before The before document
   * @param after The after document
   * @param options Options passed to HTML generation
   * @returns The diff as a HTML string
   */
  static async toEmailDiff(
    before: Document | Revision | null,
    after: Revision,
    options?: HTMLOptions
  ) {
    if (!before) {
      return "";
    }

    const html = await DocumentHelper.diff(before, after, options);
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const containsDiffElement = (node: Element | null) => {
      if (!node) {
        return false;
      }

      const diffClasses = [
        EditorStyleHelper.diffInsertion,
        EditorStyleHelper.diffDeletion,
        EditorStyleHelper.diffModification,
        EditorStyleHelper.diffNodeInsertion,
        EditorStyleHelper.diffNodeDeletion,
        EditorStyleHelper.diffNodeModification,
      ];

      return diffClasses.some(
        (className) =>
          node.classList.contains(className) ||
          node.querySelector(`.${className}`)
      );
    };

    // The diffing lib isn't able to catch all changes currently, e.g. changing
    // the type of a mark will result in an empty diff.
    // see: https://github.com/tnwinc/htmldiff.js/issues/10
    if (!containsDiffElement(doc.querySelector("#content"))) {
      return;
    }

    // We use querySelectorAll to get a static NodeList as we'll be modifying
    // it as we iterate, rather than getting content.childNodes.
    const contents = doc.querySelectorAll("#content > *");
    let previousNodeRemoved = false;
    let previousDiffClipped = false;

    const br = doc.createElement("div");
    br.innerHTML = "…";
    br.className = "diff-context-break";

    for (const childNode of contents) {
      // If the block node contains a diff tag then we want to keep it
      if (containsDiffElement(childNode as Element)) {
        if (previousNodeRemoved && previousDiffClipped) {
          childNode.parentElement?.insertBefore(br.cloneNode(true), childNode);
        }
        previousNodeRemoved = false;
        previousDiffClipped = true;

        // Special case for largetables, as this block can get very large we
        // want to clip it to only the changed rows and surrounding context.
        if (childNode.classList.contains(EditorStyleHelper.table)) {
          const rows = childNode.querySelectorAll("tr");
          if (rows.length < 3) {
            continue;
          }

          let previousRowRemoved = false;
          let previousRowDiffClipped = false;

          for (const row of rows) {
            if (containsDiffElement(row)) {
              const cells = row.querySelectorAll("td");
              if (previousRowRemoved && previousRowDiffClipped) {
                const tr = doc.createElement("tr");
                const br = doc.createElement("td");
                br.colSpan = cells.length;
                br.innerHTML = "…";
                br.className = "diff-context-break";
                tr.appendChild(br);
                childNode.parentElement?.insertBefore(tr, childNode);
              }
              previousRowRemoved = false;
              previousRowDiffClipped = true;
              continue;
            }

            if (containsDiffElement(row.nextElementSibling)) {
              previousRowRemoved = false;
              continue;
            }

            if (containsDiffElement(row.previousElementSibling)) {
              previousRowRemoved = false;
              continue;
            }

            previousRowRemoved = true;
            row.remove();
          }
        }

        continue;
      }

      // If the block node does not contain a diff tag and the previous
      // block node did not contain a diff tag then remove the previous.
      if (
        childNode.nodeName === "P" &&
        childNode.textContent &&
        childNode.nextElementSibling?.nodeName === "P" &&
        containsDiffElement(childNode.nextElementSibling)
      ) {
        if (previousDiffClipped) {
          childNode.parentElement?.insertBefore(br.cloneNode(true), childNode);
        }
        previousNodeRemoved = false;
        continue;
      }
      if (
        childNode.nodeName === "P" &&
        childNode.textContent &&
        childNode.previousElementSibling?.nodeName === "P" &&
        containsDiffElement(childNode.previousElementSibling)
      ) {
        previousNodeRemoved = false;
        continue;
      }
      previousNodeRemoved = true;
      childNode.remove();
    }

    const head = doc.querySelector("head");
    const body = doc.querySelector("body");
    return `${head?.innerHTML} ${body?.innerHTML}`;
  }

  /**
   * Applies the given Markdown to the document, this essentially creates a
   * single change in the collaborative state that makes all the edits to get
   * to the provided Markdown.
   *
   * @param document The document to apply the changes to
   * @param text The markdown to apply
   * @param editMode The edit mode to use: "replace" (default), "append", "prepend", or "patch"
   * @param findText The markdown text to find when using "patch" edit mode
   * @param disableSmartTypography When true, skips normalizing smart (curly) quotes on the patch
   *   path. Pass this when the caller's `findText` already contains the original curly-quote
   *   characters and must match them verbatim rather than after normalization.
   * @returns The document
   */
  static applyMarkdownToDocument(
    document: Document,
    text: string,
    editMode: TextEditMode = TextEditMode.Replace,
    findText?: string,
    disableSmartTypography?: boolean
  ) {
    let doc: Node;

    if (editMode === TextEditMode.Patch) {
      if (!findText) {
        throw ValidationError(
          "findText is required when using patch edit mode"
        );
      }

      const existingDoc = DocumentHelper.toProsemirror(document);
      const { markdown: rawMarkdown, blockMap } =
        serializer.serializeWithPositions(existingDoc);
      const markdown = disableSmartTypography
        ? rawMarkdown
        : DocumentHelper.normalizeMarkdown(rawMarkdown);

      const matchIndex = markdown.indexOf(findText);
      if (matchIndex === -1) {
        throw FindTextNotFoundError(
          DocumentHelper.findTextSuggestions(findText, markdown)
        );
      }
      const matchEnd = matchIndex + findText.length;

      // Find which top-level blocks overlap the matched range
      const affected = blockMap.filter(
        (b) => b.mdTo > matchIndex && b.mdFrom < matchEnd
      );

      if (affected.length === 0) {
        throw ValidationError(
          "Could not map the matched text to document content"
        );
      }

      const pmFrom = affected[0].pmFrom;
      const pmTo = affected[affected.length - 1].pmTo;

      // Try a surgical patch that preserves sibling nodes and their rich
      // content. Falls back to a full markdown re-parse of the affected
      // blocks when a surgical patch is not possible.
      const patch: PatchContext = {
        markdown,
        matchIndex,
        matchEnd,
        nodeMdFrom: affected[0].mdFrom,
        nodeMdTo: affected[0].mdTo,
        replacementText: text,
      };

      const surgicalResult =
        affected.length === 1
          ? DocumentHelper.trySurgicalPatch(existingDoc, pmFrom, pmTo, patch)
          : undefined;

      if (surgicalResult) {
        doc = surgicalResult;
      } else {
        const regionMdFrom = affected[0].mdFrom;
        const regionMdTo = affected[affected.length - 1].mdTo;
        const regionMarkdown = markdown.slice(regionMdFrom, regionMdTo);
        const localMatchStart = matchIndex - regionMdFrom;
        const localMatchEnd = matchEnd - regionMdFrom;
        const modifiedRegion =
          regionMarkdown.slice(0, localMatchStart) +
          text +
          regionMarkdown.slice(localMatchEnd);
        const newContent = parser.parse(modifiedRegion);

        const before = existingDoc.content.cut(0, pmFrom);
        const after = existingDoc.content.cut(pmTo);
        doc = existingDoc.copy(before.append(newContent.content).append(after));
      }
    } else if (editMode === TextEditMode.Append) {
      const existingDoc = DocumentHelper.toProsemirror(document);
      const newDoc = parser.parse(text);
      const lastChild = existingDoc.lastChild;
      const firstChild = newDoc.firstChild;

      if (
        !text.match(/^\s*\n/) &&
        lastChild &&
        firstChild &&
        lastChild.type.name === "paragraph" &&
        firstChild.type.name === "paragraph"
      ) {
        const mergedPara = lastChild.copy(
          lastChild.content.append(firstChild.content)
        );
        doc = existingDoc.copy(
          existingDoc.content
            .cut(0, existingDoc.content.size - lastChild.nodeSize)
            .append(Fragment.from(mergedPara))
            .append(newDoc.content.cut(firstChild.nodeSize))
        );
      } else {
        doc = existingDoc.copy(existingDoc.content.append(newDoc.content));
      }
    } else if (editMode === TextEditMode.Prepend) {
      const existingDoc = DocumentHelper.toProsemirror(document);
      const newDoc = parser.parse(text);
      const lastChild = newDoc.lastChild;
      const firstChild = existingDoc.firstChild;

      if (
        !text.match(/\n\s*$/) &&
        lastChild &&
        firstChild &&
        lastChild.type.name === "paragraph" &&
        firstChild.type.name === "paragraph"
      ) {
        const mergedPara = lastChild.copy(
          lastChild.content.append(firstChild.content)
        );
        doc = existingDoc.copy(
          newDoc.content
            .cut(0, newDoc.content.size - lastChild.nodeSize)
            .append(Fragment.from(mergedPara))
            .append(existingDoc.content.cut(firstChild.nodeSize))
        );
      } else {
        doc = existingDoc.copy(newDoc.content.append(existingDoc.content));
      }
    } else {
      doc = parser.parse(text);
    }

    document.content = doc.toJSON();
    document.text = serializer.serialize(doc);

    DocumentHelper.syncYjsState(document, doc);

    return document;
  }

  /**
   * Applies a ProseMirror JSON document to the given document, updating its
   * content, plain-text representation, and Yjs collaborative state. The
   * caller is responsible for persisting the document.
   *
   * @param document The document to update.
   * @param data The ProseMirror JSON object to apply.
   * @returns The modified document (not yet saved).
   * @throws ValidationError if the JSON is not a valid ProseMirror document.
   */
  static applyProsemirrorDataToDocument(
    document: Document,
    data: ProsemirrorData | Record<string, unknown>
  ): Document {
    let doc: Node;
    try {
      doc = Node.fromJSON(schema, data);
    } catch (err) {
      throw ValidationError(
        err instanceof Error ? err.message : "Invalid ProseMirror document"
      );
    }

    document.content = doc.toJSON();
    document.text = serializer.serialize(doc);

    DocumentHelper.syncYjsState(document, doc);

    return document;
  }

  /**
   * Synchronizes a document's Yjs collaborative state with the given
   * ProseMirror node. No-op when `document.state` is null (non-collaborative
   * document). When present, the Yjs fragment is updated in place and
   * `document.state` is re-encoded.
   *
   * @param document The document whose `state` column should be updated.
   * @param doc The ProseMirror node to write into the Yjs fragment.
   * @throws Error if the Yjs document cannot be resolved from the state.
   */
  private static syncYjsState(document: Document, doc: Node): void {
    if (!document.state) {
      return;
    }

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, document.state);
    const type = ydoc.get("default", Y.XmlFragment) as Y.XmlFragment;

    if (!type.doc) {
      throw new Error("type.doc not found");
    }

    // apply new document to existing ydoc
    updateYFragment(type.doc, type, doc, {
      mapping: new Map(),
      isOMark: new Map(),
    });

    const state = Y.encodeStateAsUpdate(ydoc);

    document.state = Buffer.from(state);
    document.changed("state", true);
  }

  /**
   * Applies a table cell background color change to a document's PM JSON and
   * persists the update via {@link applyProsemirrorDataToDocument}.
   *
   * @param document The document to update.
   * @param tableIndex Zero-based index of the target table.
   * @param row Zero-based row index of the target cell.
   * @param col Zero-based column index of the target cell.
   * @param color Hex color to set, or `null` to clear the background.
   * @returns The modified document (not yet saved).
   */
  static applyTableSetCellBackground(
    document: Document,
    tableIndex: number,
    row: number,
    col: number,
    color: string | null
  ): Document {
    const current = DocumentHelper.toProsemirror(document).toJSON() as
      | ProsemirrorData
      | Record<string, unknown>;
    const next = ProsemirrorHelper.setCellBackground(
      current as ProsemirrorData,
      tableIndex,
      row,
      col,
      color
    );
    return DocumentHelper.applyProsemirrorDataToDocument(document, next);
  }

  /**
   * Applies a column width change to a document's PM JSON and persists the
   * update via {@link applyProsemirrorDataToDocument}.
   *
   * @param document The document to update.
   * @param tableIndex Zero-based index of the target table.
   * @param col Zero-based column index to resize.
   * @param width New width in pixels (must be positive).
   * @returns The modified document (not yet saved).
   */
  static applyTableSetColumnWidth(
    document: Document,
    tableIndex: number,
    col: number,
    width: number
  ): Document {
    const current = DocumentHelper.toProsemirror(document).toJSON() as
      | ProsemirrorData
      | Record<string, unknown>;
    const next = ProsemirrorHelper.setColumnWidth(
      current as ProsemirrorData,
      tableIndex,
      col,
      width
    );
    return DocumentHelper.applyProsemirrorDataToDocument(document, next);
  }

  /**
   * Merges a rectangular range of cells in a table and persists the update via
   * {@link applyProsemirrorDataToDocument}.
   *
   * @param document The document to update.
   * @param tableIndex Zero-based index of the target table.
   * @param fromRow Top row of the merge rectangle (inclusive).
   * @param fromCol Left column of the merge rectangle (inclusive).
   * @param toRow Bottom row of the merge rectangle (inclusive).
   * @param toCol Right column of the merge rectangle (inclusive).
   * @returns The modified document (not yet saved).
   */
  static applyTableMergeCells(
    document: Document,
    tableIndex: number,
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ): Document {
    const current = DocumentHelper.toProsemirror(document).toJSON() as
      | ProsemirrorData
      | Record<string, unknown>;
    const next = ProsemirrorHelper.mergeCells(
      current as ProsemirrorData,
      tableIndex,
      fromRow,
      fromCol,
      toRow,
      toCol
    );
    return DocumentHelper.applyProsemirrorDataToDocument(document, next);
  }

  /**
   * Splits a merged cell in a table and persists the update via
   * {@link applyProsemirrorDataToDocument}.
   *
   * @param document The document to update.
   * @param tableIndex Zero-based index of the target table.
   * @param row Zero-based row index of the merged cell to split.
   * @param col Zero-based column index of the merged cell to split.
   * @returns The modified document (not yet saved).
   */
  static applyTableSplitCell(
    document: Document,
    tableIndex: number,
    row: number,
    col: number
  ): Document {
    const current = DocumentHelper.toProsemirror(document).toJSON() as
      | ProsemirrorData
      | Record<string, unknown>;
    const next = ProsemirrorHelper.splitCell(
      current as ProsemirrorData,
      tableIndex,
      row,
      col
    );
    return DocumentHelper.applyProsemirrorDataToDocument(document, next);
  }

  /**
   * Applies a layout change to a specific table in the document (toggling
   * between full-width and default content-sized layout) and persists the
   * update via {@link applyProsemirrorDataToDocument}.
   *
   * @param document The document to update.
   * @param tableIndex Zero-based index of the target table.
   * @param layout The layout to set (`TableLayout.fullWidth` or `null`).
   * @returns The modified document (not yet saved).
   */
  static applyTableSetLayout(
    document: Document,
    tableIndex: number,
    layout: TableLayout | null
  ): Document {
    const current = DocumentHelper.toProsemirror(document).toJSON() as
      | ProsemirrorData
      | Record<string, unknown>;
    const next = ProsemirrorHelper.setTableLayout(
      current as ProsemirrorData,
      tableIndex,
      layout
    );
    return DocumentHelper.applyProsemirrorDataToDocument(document, next);
  }

  /**
   * Applies multiple find-and-replace patches atomically to a document. All
   * patches are validated before any are applied — if any `findText` is not
   * found, or if any two patches overlap, the entire operation is aborted.
   * Patches are applied right-to-left by offset so that earlier offsets remain
   * valid while later substitutions are being made.
   *
   * The caller is responsible for persisting the document.
   *
   * @remark Each `findText` matches its first occurrence in the normalized
   *   markdown (mirroring the single-patch `applyMarkdownToDocument` patch
   *   behavior). Callers needing to target a specific occurrence N should
   *   disambiguate by including longer surrounding context in `findText`, or
   *   split the work into multiple serial calls so that prior replacements
   *   shift later occurrences out of the way.
   *
   * @param document The document to patch.
   * @param patches An array of `{ findText, text }` objects describing each replacement.
   * @returns The modified document (not yet saved).
   * @throws FindTextNotFoundError if any `findText` is not present in the normalized markdown.
   * @throws ValidationError if any two patches produce overlapping ranges.
   */
  static applyMultiPatch(
    document: Document,
    patches: Array<{ findText: string; text: string }>
  ): Document {
    const existingDoc = DocumentHelper.toProsemirror(document);
    const { markdown: rawMarkdown } =
      serializer.serializeWithPositions(existingDoc);
    const markdown = DocumentHelper.normalizeMarkdown(rawMarkdown);

    // First pass — find all match offsets. Abort on first miss.
    const matches: Array<{
      offset: number;
      findText: string;
      text: string;
    }> = [];
    for (const patch of patches) {
      const offset = markdown.indexOf(patch.findText);
      if (offset === -1) {
        throw FindTextNotFoundError(
          DocumentHelper.findTextSuggestions(patch.findText, markdown)
        );
      }
      matches.push({ offset, findText: patch.findText, text: patch.text });
    }

    // Second pass — validate non-overlapping. Sort by offset ascending first.
    const sorted = [...matches].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.offset + prev.findText.length > curr.offset) {
        throw ValidationError("Patches overlap");
      }
    }

    // Third pass — apply right-to-left (descending offset) to preserve earlier offsets.
    const descending = [...matches].sort((a, b) => b.offset - a.offset);
    let newMarkdown = markdown;
    for (const match of descending) {
      newMarkdown =
        newMarkdown.slice(0, match.offset) +
        match.text +
        newMarkdown.slice(match.offset + match.findText.length);
    }

    // Re-parse the fully patched markdown and update document state.
    const doc = parser.parse(newMarkdown);

    document.content = doc.toJSON();
    document.text = serializer.serialize(doc);

    DocumentHelper.syncYjsState(document, doc);

    return document;
  }

  /**
   * Finds fuzzy-match suggestions for a findText string that was not found
   * verbatim in the document markdown. Uses a sliding window over the
   * normalized markdown and the ukkonen edit-distance algorithm to collect
   * the top-3 nearest candidates.
   *
   * Guards: returns an empty array when findText is longer than 500 characters
   * or when the markdown exceeds 500,000 characters (performance protection).
   *
   * @param findText The text that was not found.
   * @param markdown The already-normalized markdown string to search within.
   * @returns up to 3 suggestions sorted by ascending edit distance.
   */
  private static findTextSuggestions(
    findText: string,
    markdown: string
  ): Array<{ offset: number; text: string; distance: number }> {
    if (findText.length > 500 || markdown.length > 500_000) {
      return [];
    }

    const threshold = Math.ceil(findText.length * 0.3);
    const windowLen = findText.length;
    const results: Array<{ offset: number; text: string; distance: number }> =
      [];

    for (let i = 0; i <= markdown.length - windowLen; i++) {
      const candidate = markdown.slice(i, i + windowLen);
      const dist = ukkonen(findText, candidate, threshold + 1);
      if (dist <= threshold) {
        results.push({ offset: i, text: candidate, distance: dist });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, 3);
  }

  /**
   * Attempt a surgical patch on a single affected top-level block. For
   * textblocks this does an inline replacement. For container nodes (lists,
   * blockquotes, etc.) it re-parses the container markdown with the
   * modification and merges with the original to preserve rich content in
   * unchanged children.
   *
   * @param existingDoc The full ProseMirror document.
   * @param pmFrom Start of the affected block in the document content.
   * @param pmTo End of the affected block in the document content.
   * @param patch The patch context.
   * @returns A new document Node on success, or undefined.
   */
  private static trySurgicalPatch(
    existingDoc: Node,
    pmFrom: number,
    pmTo: number,
    patch: PatchContext
  ): Node | undefined {
    const blockNode = existingDoc.nodeAt(pmFrom);
    if (!blockNode) {
      return undefined;
    }

    const patchedBlock = DocumentHelper.patchNode(blockNode, patch);

    if (!patchedBlock) {
      return undefined;
    }

    const before = existingDoc.content.cut(0, pmFrom);
    const after = existingDoc.content.cut(pmTo);
    return existingDoc.copy(
      before.append(Fragment.from(patchedBlock)).append(after)
    );
  }

  /**
   * Recursively patch a single node. For textblocks, performs an inline
   * replacement. For container nodes, serializes children to find which
   * child contains the match, patches that child, and preserves siblings.
   *
   * @param node The node to patch.
   * @param patch The patch context.
   * @returns The patched node, or undefined to fall back.
   */
  private static patchNode(node: Node, patch: PatchContext): Node | undefined {
    if (node.isTextblock) {
      return DocumentHelper.tryInlinePatch(node, patch);
    }

    const {
      markdown,
      matchIndex,
      matchEnd,
      nodeMdFrom,
      nodeMdTo,
      replacementText,
    } = patch;

    // Container node (list, blockquote, etc.): re-parse the container's
    // markdown with the modification applied, then merge with the original
    // to preserve rich content (comment marks, highlight colors, etc.) in
    // children whose text content did not change.
    const containerMd = markdown.slice(nodeMdFrom, nodeMdTo);
    const localStart = matchIndex - nodeMdFrom;
    const localEnd = matchEnd - nodeMdFrom;
    const modifiedMd =
      containerMd.slice(0, localStart) +
      replacementText +
      containerMd.slice(localEnd);

    const parsed = parser.parse(modifiedMd.replace(/^\n+/, ""));
    const newContainer = DocumentHelper.findChildOfType(parsed, node.type);

    if (!newContainer) {
      return undefined;
    }

    // Parse the original (unmodified) container markdown to get a round-trip
    // baseline. This lets mergeNodes distinguish attrs that were intentionally
    // changed by the modification from attrs lost during markdown round-trip.
    const originalParsed = parser.parse(containerMd.replace(/^\n+/, ""));
    const roundTripped = DocumentHelper.findChildOfType(
      originalParsed,
      node.type
    );

    return DocumentHelper.mergeNodes(node, newContainer, roundTripped);
  }

  /**
   * Find the first child of a parsed document that matches the given type.
   *
   * @param doc The parsed document to search.
   * @param type The node type to find.
   * @returns The first matching child, or undefined.
   */
  private static findChildOfType(doc: Node, type: NodeType): Node | undefined {
    let result: Node | undefined;
    doc.forEach((child: Node) => {
      if (child.type === type && !result) {
        result = child;
      }
    });
    return result;
  }

  /**
   * Recursively merge two structurally similar nodes. Children whose text
   * content is unchanged are kept from the original (preserving attributes
   * that cannot be represented in markdown, such as comment marks or
   * highlight colors). Children whose content changed use the updated version.
   *
   * @param original The original node with rich content to preserve.
   * @param updated The re-parsed node with the modification applied.
   * @param roundTripped The original node after a markdown round-trip, used
   *   to distinguish intentional attr changes from round-trip losses.
   * @returns The merged node.
   */
  private static mergeNodes(
    original: Node,
    updated: Node,
    roundTripped?: Node
  ): Node {
    if (original.isTextblock || original.isLeaf) {
      return updated;
    }

    const oldChildren: Node[] = [];
    const newChildren: Node[] = [];
    const rtChildren: Node[] = [];
    original.forEach((child: Node) => oldChildren.push(child));
    updated.forEach((child: Node) => newChildren.push(child));
    roundTripped?.forEach((child: Node) => rtChildren.push(child));

    // If structure changed significantly, use the fully re-parsed version.
    if (oldChildren.length !== newChildren.length) {
      return updated;
    }

    const merged: Node[] = [];
    for (let i = 0; i < oldChildren.length; i++) {
      const oldChild = oldChildren[i];
      const newChild = newChildren[i];
      const rtChild = rtChildren[i];

      if (oldChild.type !== newChild.type) {
        return updated;
      }

      const textSame = oldChild.textContent === newChild.textContent;

      if (textSame && oldChild.sameMarkup(newChild)) {
        // Fully unchanged — keep original with its rich content
        merged.push(oldChild);
      } else if (textSame) {
        // Attrs changed (e.g. checked state) but content same — merge attrs
        // so that non-markdown-representable values (colwidth, highlight
        // colors, etc.) are preserved from the original while intentional
        // changes from the re-parsed version are applied.
        const mergedAttrs = DocumentHelper.mergeAttrs(
          oldChild,
          newChild,
          rtChild
        );
        merged.push(
          oldChild.type.create(mergedAttrs, oldChild.content, oldChild.marks)
        );
      } else if (!oldChild.isTextblock && !oldChild.isLeaf) {
        // Both are containers — recurse to preserve rich content deeper
        merged.push(DocumentHelper.mergeNodes(oldChild, newChild, rtChild));
      } else {
        merged.push(newChild);
      }
    }

    // Merge container attrs so markdown-driven changes (e.g. ordered list
    // order/listStyle) are applied while preserving non-markdown attrs.
    const mergedAttrs = DocumentHelper.mergeAttrs(
      original,
      updated,
      roundTripped
    );

    return original.type.create(
      mergedAttrs,
      Fragment.from(merged),
      original.marks
    );
  }

  /**
   * Merge attrs from an original and re-parsed node. When a round-tripped
   * baseline is available, attrs whose updated value matches the round-trip
   * value are considered unchanged (possibly lost in the round-trip) and the
   * original is preserved. Attrs that differ from the round-trip baseline
   * were intentionally changed and the updated value is used.
   *
   * @param original The original node with potentially rich attrs.
   * @param updated The re-parsed node with the modification applied.
   * @param roundTripped The original node after a markdown round-trip.
   * @returns The merged attrs object.
   */
  private static mergeAttrs(
    original: Node,
    updated: Node,
    roundTripped?: Node
  ): Record<string, unknown> {
    if (!roundTripped) {
      return updated.attrs;
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(original.attrs)) {
      const newVal = updated.attrs[key];
      const oldVal = original.attrs[key];
      const rtVal = roundTripped.attrs[key];

      // If the updated value matches what a round-trip of the original
      // produces, the modification did not change this attr — preserve the
      // original (which may have richer data lost in markdown round-trip).
      if (JSON.stringify(newVal) === JSON.stringify(rtVal)) {
        result[key] = oldVal;
      } else {
        result[key] = newVal;
      }
    }
    return result;
  }

  /**
   * Attempt an inline-level patch within a single textblock node. Returns the
   * patched block node on success, or undefined if an inline patch is not
   * possible and the caller should fall back to block-level replacement.
   *
   * @param blockNode The textblock node containing the match.
   * @param patch The patch context.
   * @returns The patched block node, or undefined.
   */
  private static tryInlinePatch(
    blockNode: Node,
    patch: PatchContext
  ): Node | undefined {
    const {
      markdown,
      matchIndex,
      matchEnd,
      nodeMdFrom,
      nodeMdTo,
      replacementText,
    } = patch;
    // Strip the leading block separator (newlines) to get the block's own
    // markdown content and the offset of that content within the full string.
    const blockMdRaw = markdown.slice(nodeMdFrom, nodeMdTo);
    const separatorLen =
      blockMdRaw.length - blockMdRaw.replace(/^\n+/, "").length;
    const contentMdStart = nodeMdFrom + separatorLen;

    // Positions of the match relative to the block's content markdown.
    const localMdFrom = matchIndex - contentMdStart;
    const localMdTo = matchEnd - contentMdStart;

    if (localMdFrom < 0) {
      return undefined;
    }

    // Build a map from text-content offset to PM Fragment offset by walking
    // the block's inline children. For text nodes each character maps 1:1;
    // for atom inline nodes (images, mentions) the nodeSize may differ from
    // the text they contribute.
    const blockText = blockNode.textContent;
    const segments: InlineSegment[] = [];
    let textOffset = 0;

    blockNode.forEach((child: Node, offset: number) => {
      const childTextLen = child.isText
        ? child.text!.length
        : child.type.spec.leafText
          ? (child.type.spec.leafText as (n: Node) => string)(child).length
          : 0;

      segments.push({
        textFrom: textOffset,
        textTo: textOffset + childTextLen,
        pmFrom: offset,
        pmTo: offset + child.nodeSize,
        isAtom: !child.isText && childTextLen !== child.nodeSize,
      });
      textOffset += childTextLen;
    });

    // Map the match to text-content positions. When the block's markdown
    // equals its plain text, markdown offsets map 1:1. When they differ
    // (atoms like mentions, or formatting marks), locate the match in the
    // block's textContent directly.
    let localTextFrom = localMdFrom;
    let localTextTo = localMdTo;

    const contentMd = markdown.slice(
      contentMdStart,
      contentMdStart + blockText.length
    );
    if (contentMd !== blockText) {
      const findStr = markdown.slice(matchIndex, matchEnd);
      const textIdx = blockText.indexOf(findStr);
      if (textIdx < 0) {
        return undefined;
      }
      localTextFrom = textIdx;
      localTextTo = textIdx + findStr.length;
    }

    // Atom inline nodes (mentions, images) have text representations that
    // don't map 1:1 to PM offsets. Only bail when atoms overlap the match
    // range — atoms outside the range are safely preserved by the splice.
    const hasOverlappingAtom = segments.some(
      (seg) =>
        seg.isAtom && seg.textTo > localTextFrom && seg.textFrom < localTextTo
    );
    if (hasOverlappingAtom) {
      return undefined;
    }

    // Resolve text-content positions to PM Fragment positions.
    const pmInlineFrom = DocumentHelper.textToPmOffset(segments, localTextFrom);
    const pmInlineTo = DocumentHelper.textToPmOffset(segments, localTextTo);

    if (pmInlineFrom < 0 || pmInlineTo < 0) {
      return undefined;
    }

    // Parse the replacement markdown and extract inline content only when it
    // resolves to a single textblock. Multi-block or non-textblock content
    // should fall back to block-level replacement rather than being silently
    // truncated during inline patching. Markdown parsing can trim whitespace,
    // so when the parsed result is plain text we use the raw replacement
    // string to preserve exact whitespace.
    const parsed = parser.parse(replacementText);
    const firstBlock = parsed.firstChild;

    if (parsed.childCount !== 1 || !firstBlock?.isTextblock) {
      return undefined;
    }

    let replacementContent: Fragment;

    if (
      firstBlock.content.childCount === 1 &&
      firstBlock.firstChild?.isText &&
      !firstBlock.firstChild.marks.length
    ) {
      // Plain text replacement — use the raw string to avoid whitespace trimming
      replacementContent = Fragment.from(schema.text(replacementText));
    } else {
      replacementContent = firstBlock.content;
    }

    // Splice: keep inline content before match + replacement + after match.
    const inlineBefore = blockNode.content.cut(0, pmInlineFrom);
    const inlineAfter = blockNode.content.cut(pmInlineTo);
    return blockNode.copy(
      inlineBefore.append(replacementContent).append(inlineAfter)
    );
  }

  /**
   * Convert a text-content offset to a ProseMirror Fragment offset using a
   * pre-built segment map.
   *
   * @param segments The segment map from text offsets to PM offsets.
   * @param textPos The text-content offset to convert.
   * @returns The corresponding PM Fragment offset, or -1.
   */
  private static textToPmOffset(
    segments: InlineSegment[],
    textPos: number
  ): number {
    for (const seg of segments) {
      if (textPos >= seg.textFrom && textPos <= seg.textTo) {
        return seg.pmFrom + (textPos - seg.textFrom);
      }
    }
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      if (textPos >= last.textTo) {
        return last.pmTo;
      }
    }
    return -1;
  }

  /**
   * Returns information about each top-level block node in the document.
   * Each entry includes the block's positional index, ProseMirror node type
   * name, plain-text content, node attrs, an 8-hex-char content hash, and
   * the full ProseMirror JSON for the block.
   *
   * @param document The document to inspect.
   * @returns An array of BlockInfo objects, one per top-level block.
   */
  static getBlocks(document: Document): Array<BlockInfo> {
    const doc = DocumentHelper.toProsemirror(document);
    const blocks: Array<BlockInfo> = [];

    doc.content.forEach((node: Node, _offset: number, index: number) => {
      const nodeJson = node.toJSON();
      const contentHash = createHash("md5")
        .update(JSON.stringify(nodeJson))
        .digest("hex")
        .slice(0, 8);

      blocks.push({
        index,
        type: node.type.name,
        textContent: node.textContent,
        attrs: { ...node.attrs },
        contentHash,
        data: nodeJson,
      });
    });

    return blocks;
  }

  /**
   * Replaces a single top-level block node in the document at the given
   * positional index. The caller is responsible for persisting the document.
   *
   * @param document The document to modify.
   * @param blockIndex Zero-based index of the top-level block to replace.
   * @param opts Replacement options — provide either `data` (ProseMirror JSON)
   *   or `text` (Markdown), and optionally a `contentHash` for optimistic
   *   concurrency validation.
   * @returns The modified document (not yet saved).
   * @throws ValidationError if blockIndex is out of range.
   * @throws ValidationError if contentHash is provided and does not match.
   * @throws ValidationError if the replacement data/text is invalid.
   */
  static updateBlock(
    document: Document,
    blockIndex: number,
    opts: { data?: object; text?: string; contentHash?: string }
  ): Document {
    const existingDoc = DocumentHelper.toProsemirror(document);
    const children: Node[] = [];
    existingDoc.content.forEach((child: Node) => children.push(child));

    if (blockIndex >= children.length) {
      throw ValidationError("blockIndex out of range");
    }

    if (opts.contentHash !== undefined) {
      const currentNode = children[blockIndex];
      const currentHash = createHash("md5")
        .update(JSON.stringify(currentNode.toJSON()))
        .digest("hex")
        .slice(0, 8);

      if (currentHash !== opts.contentHash) {
        throw ValidationError("Stale contentHash — block changed");
      }
    }

    let newBlock: Node;

    if (opts.data !== undefined) {
      try {
        newBlock = Node.fromJSON(schema, opts.data);
      } catch (err) {
        throw ValidationError(
          err instanceof Error ? err.message : "Invalid ProseMirror node data"
        );
      }
    } else if (opts.text !== undefined) {
      const parsed = parser.parse(opts.text);

      if (parsed.childCount !== 1) {
        throw ValidationError(
          "text must resolve to exactly one block node; use data for multi-block replacements"
        );
      }

      newBlock = parsed.firstChild!;
    } else {
      throw ValidationError("one of data or text is required");
    }

    // Compute the Fragment offset of the target block by summing previous node sizes.
    let blockOffset = 0;
    for (let i = 0; i < blockIndex; i++) {
      blockOffset += children[i].nodeSize;
    }

    const before = existingDoc.content.cut(0, blockOffset);
    const after = existingDoc.content.cut(
      blockOffset + children[blockIndex].nodeSize
    );

    const newDoc = existingDoc.copy(
      before.append(Fragment.from(newBlock)).append(after)
    );

    document.content = newDoc.toJSON();
    document.text = serializer.serialize(newDoc);

    DocumentHelper.syncYjsState(document, newDoc);

    return document;
  }

  /**
   * Compares two documents or revisions and returns whether the text differs by more than the threshold.
   *
   * @param document The document to compare
   * @param other The other document to compare
   * @param threshold The threshold for the change in characters
   * @returns True if the text differs by more than the threshold
   */
  public static isChangeOverThreshold(
    before: Document | Revision | null,
    after: Document | Revision | null,
    threshold: number
  ) {
    if (!before || !after) {
      return false;
    }

    const first = before.title + this.toPlainText(before);
    const second = after.title + this.toPlainText(after);
    const distance = ukkonen(first, second, threshold + 1);
    return distance > threshold;
  }

  /**
   * Sorts an array of documents based on their order in the collection's document structure.
   * Documents are ordered according to their position in the navigation structure, with
   * documents not found in the structure placed at the end. The result is reversed to
   * account for documents being added in reverse order during processing.
   *
   * @param documents - Array of Document objects to be sorted
   * @param documentStructure - Array of NavigationNode objects representing the collection's document hierarchy
   * @returns Sorted array of documents in the order they appear in the document structure
   *
   **/
  public static sortDocumentsByStructure(
    documents: Document[],
    documentStructure: NavigationNode[]
  ): Document[] {
    if (!documentStructure.length) {
      return documents;
    }

    const orderMap = new Map<string, number>();
    documentStructure.forEach((node, index) => {
      orderMap.set(node.id, index);
    });

    return documents.sort((a, b) => {
      const orderA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;

      return orderA - orderB;
    });
  }
}
