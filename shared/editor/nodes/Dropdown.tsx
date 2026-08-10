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
import { createPortal } from "react-dom";
import { observer } from "mobx-react";
import { useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  defaultDropdownDefinition,
  dropdownMarkdownRule,
  getDropdownDefinitions,
  getDropdownDefinition,
  getDocumentDropdownDefinitions,
  getSelectedDropdownOption,
} from "../lib/dropdowns";
import type { DropdownAttrs, DropdownDefinition } from "../lib/dropdowns";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { isRemoteTransaction } from "../lib/multiplayer";
import { transactionTouchesNodeTypes } from "../lib/transactionTouchesNodeTypes";
import type { WidgetProps } from "../lib/Extension";
import { DropdownMenu } from "../components/DropdownMenu";
import Node from "./Node";
import { DropdownMenuController } from "./DropdownMenuController";
import { DropdownView } from "./DropdownView";

interface DropdownRepairState {
  initialRepairNeeded: boolean;
}

interface DropdownMenuWidgetProps {
  controller: DropdownMenuController;
}

const DropdownMenuWidget = observer(function DropdownMenuWidget({
  controller,
}: DropdownMenuWidgetProps) {
  useEffect(() => {
    controller.markWidgetMounted();
    return controller.markWidgetUnmounted;
  }, [controller]);
  const activeView = controller.activeView;
  const definition = controller.definition;
  const selectedOptionId = controller.selectedOptionId;
  const rect = controller.rect;
  if (!activeView || !definition || !selectedOptionId || !rect) {
    return null;
  }

  return createPortal(
    <span
      ref={controller.setMenuElement}
      data-dropdown-menu-revision={controller.revision}
    >
      <DropdownMenu
        definition={definition}
        selectedOptionId={selectedOptionId}
        anchorRect={rect}
        focusKey={activeView.id}
        onSelect={controller.handleSelect}
        onEscape={controller.handleEscape}
      />
    </span>,
    activeView.dom.ownerDocument.body
  );
});

const dropdownNodeTypes = new Set(["dropdown"]);
const dropdownPresentationNodeTypes = new Set(["dropdown_definition"]);
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

/**
 * Inline document dropdown chip backed by document-level definitions.
 */
export default class Dropdown extends Node {
  private readonly menuController = new DropdownMenuController();

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

  get rulePlugins() {
    return [dropdownMarkdownRule];
  }

  /** Renders the extension's singleton dropdown menu under editor context.
   *
   * @param _props the editor widget properties.
   * @returns the menu portal adapter, which renders null while closed.
   */
  widget = (_props: WidgetProps) => (
    <DropdownMenuWidget controller={this.menuController} />
  );

  get plugins() {
    const controller = this.menuController;
    const presentationPluginKey = new PluginKey<number>(
      "dropdown-presentation"
    );
    const presentationPlugin = new Plugin<number>({
      key: presentationPluginKey,
      state: {
        init: () => 0,
        apply: (transaction, value, oldState, newState) => {
          if (!transaction.docChanged) {
            return value;
          }
          const definitionChanged = transactionTouchesNodeTypes(
            transaction,
            oldState,
            newState,
            dropdownPresentationNodeTypes
          );
          const broadRemoteReplacement =
            isRemoteTransaction(transaction) &&
            !isIdentityInvariantDropdownSelection(
              transaction,
              oldState,
              newState
            ) &&
            transactionTouchesNodeTypes(
              transaction,
              oldState,
              newState,
              dropdownNodeTypes
            );
          if (!definitionChanged && !broadRemoteReplacement) {
            return value;
          }
          return value + 1;
        },
      },
      props: {
        nodeViews: {
          [this.name]: (node, view, getPos, decorations) =>
            new DropdownView(node, view, getPos, controller, decorations),
        },
      },
      view: (view) => {
        controller.attach(view, () => this.editor.forceUpdate());
        let generation = presentationPluginKey.getState(view.state) ?? 0;
        let editable = view.editable;
        return {
          update: () => {
            const nextGeneration =
              presentationPluginKey.getState(view.state) ?? generation;
            const editableChanged = editable !== view.editable;
            editable = view.editable;
            if (generation === nextGeneration && !editableChanged) {
              return;
            }
            generation = nextGeneration;
            controller.refreshAll();
          },
          destroy: () => controller.destroy(),
        };
      },
    });

    return [
      presentationPlugin,
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
