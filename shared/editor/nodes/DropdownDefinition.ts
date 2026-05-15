import type { Token } from "markdown-it";
import type { Node as ProsemirrorNode, NodeSpec } from "prosemirror-model";
import {
  defaultDropdownDefinition,
  getDropdownDefinitions,
  serializeDropdownDefinitions,
} from "../lib/dropdowns";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
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
