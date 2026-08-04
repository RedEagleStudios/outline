import type { Token } from "markdown-it";
import type {
  Node as ProsemirrorNode,
  NodeSpec,
  NodeType,
} from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import { AttrStep } from "prosemirror-transform";
import * as React from "react";
import * as ReactDOM from "react-dom";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import { s } from "../../styles";
import {
  defaultDropdownDefinition,
  dropdownMarkdownRule,
  getDropdownDefinitions,
  getDropdownDefinition,
  getDocumentDropdownDefinitions,
  getSelectedDropdownOption,
} from "../lib/dropdowns";
import type {
  DropdownAttrs,
  DropdownDefinition,
  DropdownOption,
} from "../lib/dropdowns";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { transactionTouchesNodeTypes } from "../lib/transactionTouchesNodeTypes";
import type { ComponentProps } from "../types";
import Node from "./Node";

interface DropdownRepairState {
  initialRepairNeeded: boolean;
}

const dropdownNodeTypes = new Set(["dropdown"]);
const dropdownRepairPluginKey = new PluginKey<DropdownRepairState>(
  "dropdown-repair"
);

function documentNeedsDropdownRepair(doc: ProsemirrorNode): boolean {
  const existingIds = new Set<string>();
  let repairNeeded = false;

  doc.descendants((node) => {
    if (node.type.name !== "dropdown") {
      return !repairNeeded;
    }

    if (!node.attrs.dropdownId && node.attrs.options) {
      repairNeeded = true;
      return false;
    }

    const nodeId = node.attrs.id;
    if (typeof nodeId !== "string" || existingIds.has(nodeId)) {
      repairNeeded = true;
      return false;
    }

    existingIds.add(nodeId);
    return true;
  });

  return repairNeeded;
}

function isIdentityInvariantDropdownSelection(
  transaction: Transaction,
  oldState: EditorState,
  newState: EditorState
): boolean {
  if (!transaction.steps.length) {
    return false;
  }

  let currentDoc = oldState.doc;
  for (const step of transaction.steps) {
    if (!(step instanceof AttrStep) || step.attr !== "selectedOptionId") {
      return false;
    }

    const previousNode = currentDoc.nodeAt(step.pos);
    const nextDoc = step.apply(currentDoc).doc;
    const nextNode = nextDoc?.nodeAt(step.pos);
    if (
      !nextDoc ||
      previousNode?.type.name !== "dropdown" ||
      nextNode?.type.name !== "dropdown" ||
      previousNode.attrs.id !== nextNode.attrs.id ||
      previousNode.attrs.dropdownId !== nextNode.attrs.dropdownId ||
      previousNode.attrs.options !== nextNode.attrs.options
    ) {
      return false;
    }

    currentDoc = nextDoc;
  }

  return currentDoc.eq(newState.doc);
}

function getDefaultAttrs(): DropdownAttrs {
  return {
    id: uuidv4(),
    dropdownId: defaultDropdownDefinition.id,
    selectedOptionId: defaultDropdownDefinition.options[0].id,
  };
}

function DropdownComponent({ node, view, getPos, isEditable }: ComponentProps) {
  const [open, setOpen] = React.useState(false);
  const [menuRect, setMenuRect] = React.useState<DOMRect>();
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const menuRef = React.useRef<HTMLSpanElement>(null);
  const definition = getDropdownDefinition(view.state.doc, node.attrs);
  const selectedOption = getSelectedDropdownOption(
    definition,
    node.attrs.selectedOptionId
  );

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const updateMenuRect = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();

      if (rect) {
        setMenuRect(rect);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;

      if (
        wrapperRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }

      setOpen(false);
    };

    updateMenuRect();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", updateMenuRect, true);
    window.addEventListener("resize", updateMenuRect);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", updateMenuRect, true);
      window.removeEventListener("resize", updateMenuRect);
    };
  }, [open]);

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isEditable) {
      return;
    }

    setOpen((previous) => !previous);
  };

  const handleSelect = (option: DropdownOption) => {
    const pos = getPos();
    const transaction = view.state.tr.setNodeAttribute(
      pos,
      "selectedOptionId",
      option.id
    );

    view.dispatch(transaction);
    view.focus();
    setOpen(false);
  };

  return (
    <Wrapper ref={wrapperRef} contentEditable={false}>
      <Chip
        type="button"
        $color={selectedOption.color}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!isEditable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleToggle}
      >
        {selectedOption.label}
        {isEditable && <Caret aria-hidden>▾</Caret>}
      </Chip>
      {open &&
        menuRect &&
        ReactDOM.createPortal(
          <Menu
            ref={menuRef}
            role="menu"
            aria-label={definition.name}
            $top={menuRect.bottom + 4}
            $left={menuRect.left}
          >
            <MenuHeader>{definition.name}</MenuHeader>
            {definition.options.map((option) => (
              <MenuItem
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === selectedOption.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(option)}
              >
                <OptionPill $color={option.color}>{option.label}</OptionPill>
              </MenuItem>
            ))}
          </Menu>,
          document.body
        )}
    </Wrapper>
  );
}

/**
 * Inline document dropdown chip backed by document-level definitions.
 */
export default class Dropdown extends Node {
  get name() {
    return "dropdown";
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        id: {
          default: undefined,
        },
        dropdownId: {
          default: defaultDropdownDefinition.id,
          validate: "string",
        },
        selectedOptionId: {
          default: defaultDropdownDefinition.options[0].id,
          validate: "string",
        },
        // Legacy MVP attrs are preserved so existing chips can be read and migrated.
        name: {
          default: undefined,
        },
        options: {
          default: undefined,
        },
      },
      inline: true,
      marks: "",
      group: "inline",
      atom: true,
      selectable: false,
      parseDOM: [
        {
          tag: `span.${this.name}`,
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLElement) => ({
            id: dom.dataset.id,
            dropdownId: dom.dataset.dropdownId ?? defaultDropdownDefinition.id,
            selectedOptionId:
              dom.dataset.selectedOptionId ??
              defaultDropdownDefinition.options[0].id,
          }),
        },
      ],
      toDOM: (node) => {
        const definition = getDropdownDefinition(
          node.type.schema.node("doc", undefined, [
            node.type.schema.node("paragraph"),
          ]),
          node.attrs
        );
        const selectedOption = getSelectedDropdownOption(
          definition,
          node.attrs.selectedOptionId
        );

        return [
          "span",
          {
            class: this.name,
            "data-id": node.attrs.id,
            "data-dropdown-id": node.attrs.dropdownId,
            "data-selected-option-id": node.attrs.selectedOptionId,
          },
          selectedOption.label,
        ];
      },
      leafText: (node) => {
        const definition = getDropdownDefinition(
          node.type.schema.node("doc", undefined, [
            node.type.schema.node("paragraph"),
          ]),
          node.attrs
        );

        return getSelectedDropdownOption(
          definition,
          node.attrs.selectedOptionId
        ).label;
      },
    };
  }

  component = DropdownComponent;

  get rulePlugins() {
    return [dropdownMarkdownRule];
  }

  get plugins() {
    return [
      new Plugin({
        key: dropdownRepairPluginKey,
        state: {
          init: (_, state): DropdownRepairState => ({
            initialRepairNeeded: documentNeedsDropdownRepair(state.doc),
          }),
          apply: (transaction, pluginState): DropdownRepairState =>
            transaction.getMeta(dropdownRepairPluginKey)
              ? { initialRepairNeeded: false }
              : pluginState,
        },
        appendTransaction: (transactions, oldState, newState) => {
          if (
            transactions.some((transaction) =>
              transaction.getMeta(dropdownRepairPluginKey)
            )
          ) {
            return null;
          }

          const pluginState = dropdownRepairPluginKey.getState(newState);
          const documentTransactions = transactions.filter(
            (transaction) => transaction.docChanged
          );
          if (!pluginState?.initialRepairNeeded) {
            if (!documentTransactions.length) {
              return null;
            }

            if (
              transactions.length === 1 &&
              (isIdentityInvariantDropdownSelection(
                documentTransactions[0],
                oldState,
                newState
              ) ||
                !transactionTouchesNodeTypes(
                  documentTransactions[0],
                  oldState,
                  newState,
                  dropdownNodeTypes
                ))
            ) {
              return null;
            }
          }

          const tr = newState.tr;
          const existingIds = new Set<string>();
          let modified = false;

          tr.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) {
              return;
            }

            if (!node.attrs.dropdownId && node.attrs.options) {
              modified = true;
              tr.setNodeAttribute(
                pos,
                "dropdownId",
                defaultDropdownDefinition.id
              );
            }

            const nodeId = node.attrs.id;
            if (typeof nodeId === "string" && !existingIds.has(nodeId)) {
              existingIds.add(nodeId);
              return;
            }

            const nextId = uuidv4();
            existingIds.add(nextId);
            modified = true;
            tr.setNodeAttribute(pos, "id", nextId);
          });

          if (modified || pluginState?.initialRepairNeeded) {
            return tr.setMeta(dropdownRepairPluginKey, true);
          }

          return null;
        },
      }),
    ];
  }

  commands({ type }: { type: NodeType }) {
    return (
        attrs: Partial<DropdownAttrs> & {
          definition?: DropdownDefinition;
        } = {}
      ): Command =>
      (state, dispatch) => {
        const { selection } = state;
        const position = selection.from;

        const defaultAttrs = getDefaultAttrs();
        const definitions = getDocumentDropdownDefinitions(state.doc);
        const definition = attrs.definition
          ? getDropdownDefinitions([attrs.definition])[0]
          : undefined;
        const dropdownId =
          definition?.id ?? attrs.dropdownId ?? defaultAttrs.dropdownId;
        const dropdownDefinition =
          definitions.find((candidate) => candidate.id === dropdownId) ??
          definition ??
          defaultDropdownDefinition;
        const selectedOption =
          dropdownDefinition.options.find(
            (option) => option.id === attrs.selectedOptionId
          ) ?? dropdownDefinition.options[0];
        const node = type.create({
          ...defaultAttrs,
          ...attrs,
          id: attrs.id ?? defaultAttrs.id,
          dropdownId: dropdownDefinition.id,
          selectedOptionId: selectedOption.id,
          name: dropdownDefinition.name,
          options: dropdownDefinition.options,
        });

        const transaction = state.tr.replaceSelectionWith(node);
        const hasDefinition = definitions.some(
          (candidate) => candidate.id === dropdownDefinition.id
        );

        if (!hasDefinition) {
          const definitionType = state.schema.nodes.dropdown_definition;
          if (definitionType) {
            transaction.insert(
              transaction.doc.content.size,
              definitionType.create(dropdownDefinition)
            );
          }
        }

        dispatch?.(
          transaction.setSelection(
            TextSelection.near(
              transaction.doc.resolve(position + node.nodeSize)
            )
          )
        );
        return true;
      };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.write(
      `{dropdown:${node.attrs.dropdownId}|${node.attrs.selectedOptionId}}`
    );
  }

  parseMarkdown() {
    return {
      node: "dropdown",
      getAttrs: (token: Token) => ({
        id: uuidv4(),
        dropdownId: token.attrGet("dropdownId") ?? defaultDropdownDefinition.id,
        selectedOptionId:
          token.attrGet("selectedOptionId") ??
          defaultDropdownDefinition.options[0].id,
      }),
    };
  }
}

const Wrapper = styled.span`
  display: inline-flex;
  vertical-align: baseline;
`;

const Chip = styled.button<{ $color: string }>`
  align-items: center;
  background: ${({ $color }) => $color};
  border: 0;
  border-radius: 999px;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.9em;
  font-weight: 500;
  gap: 4px;
  line-height: 1.25;
  margin: 0 1px;
  padding: 1px 7px;
  vertical-align: baseline;

  &:disabled {
    cursor: default;
  }
`;

const Caret = styled.span`
  font-size: 0.8em;
  line-height: 1;
  opacity: 0.85;
`;

const Menu = styled.span<{ $top: number; $left: number }>`
  background: ${s("menuBackground")};
  border-radius: 6px;
  box-shadow: ${s("menuShadow")};
  display: grid;
  gap: 3px;
  left: ${({ $left }) => `${$left}px`};
  min-width: 180px;
  padding: 8px;
  position: fixed;
  top: ${({ $top }) => `${$top}px`};
  z-index: 1000;
`;

const MenuHeader = styled.span`
  color: ${s("textSecondary")};
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 6px 6px;
  text-transform: uppercase;
`;

const MenuItem = styled.button`
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  font: inherit;
  padding: 5px 6px;
  text-align: left;

  &[aria-checked="true"],
  &:hover {
    background: ${s("sidebarBackground")};
  }
`;

const OptionPill = styled.span<{ $color: string }>`
  background: ${({ $color }) => $color};
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  padding: 2px 7px;
`;
