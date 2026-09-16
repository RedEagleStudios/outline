import type { Token } from "markdown-it";
import type { Node as ProsemirrorNode, NodeSpec } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import {
  defaultDropdownDefinition,
  getDocumentDropdownDefinitions,
  getDropdownDefinitions,
  serializeDropdownDefinitions,
} from "../lib/dropdowns";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { transactionTouchesNodeTypes } from "../lib/transactionTouchesNodeTypes";
import Node from "./Node";

/**
 * Hidden document-level dropdown definition node.
 */
export default class DropdownDefinition extends Node {
  get name() {
    return "dropdown_definition";
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        id: {
          default: defaultDropdownDefinition.id,
          validate: "string",
        },
        name: {
          default: defaultDropdownDefinition.name,
          validate: "string",
        },
        options: {
          default: defaultDropdownDefinition.options,
        },
      },
      atom: true,
      group: "block",
      selectable: false,
      parseDOM: [
        {
          tag: `div.${this.name}`,
          getAttrs: (dom: HTMLElement) => {
            try {
              return getDropdownDefinitions([
                JSON.parse(dom.dataset.definition ?? "{}"),
              ])[0];
            } catch (_err) {
              return defaultDropdownDefinition;
            }
          },
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: this.name,
          hidden: "true",
          "data-definition": JSON.stringify(node.attrs),
        },
      ],
    };
  }

  /** Preserves definitions while surviving chips still reference them. */
  get plugins() {
    const nodeTypes = new Set([this.name]);

    return [
      new Plugin({
        appendTransaction: (transactions, oldState, newState) => {
          if (
            !transactions.some((transaction) => transaction.docChanged) ||
            (transactions.length === 1 &&
              !transactionTouchesNodeTypes(
                transactions[0],
                oldState,
                newState,
                nodeTypes
              ))
          ) {
            return null;
          }

          const previousDefinitions = getDocumentDropdownDefinitions(
            oldState.doc
          );
          if (!previousDefinitions.length) {
            return null;
          }

          const currentIds = new Set(
            getDocumentDropdownDefinitions(newState.doc).map(({ id }) => id)
          );
          const missingDefinitions = new Map(
            previousDefinitions
              .filter(({ id }) => !currentIds.has(id))
              .map((definition) => [definition.id, definition])
          );
          if (!missingDefinitions.size) {
            return null;
          }

          const definitions: ProsemirrorNode[] = [];
          newState.doc.descendants((node) => {
            if (node.type.name !== "dropdown") {
              return missingDefinitions.size > 0;
            }
            const definition = missingDefinitions.get(node.attrs.dropdownId);
            if (definition) {
              definitions.push(
                newState.schema.nodes[this.name].create(definition)
              );
              missingDefinitions.delete(definition.id);
            }
            return false;
          });

          // Definitions are document metadata, not editable content. Move deleted
          // definitions to the end so they no longer obstruct this text boundary.
          return definitions.length
            ? newState.tr.insert(newState.doc.content.size, definitions)
            : null;
        },
      }),
    ];
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    if (state.out.includes(serializeDropdownDefinitions([node.attrs]))) {
      return;
    }

    state.write(serializeDropdownDefinitions([node.attrs]));
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      node: "dropdown_definition",
      getAttrs: (token: Token) =>
        getDropdownDefinitions([
          {
            id: token.attrGet("id"),
            name: token.attrGet("name"),
            options: JSON.parse(token.attrGet("options") ?? "[]"),
          },
        ])[0],
    };
  }
}
