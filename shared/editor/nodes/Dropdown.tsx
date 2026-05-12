import type {
  Node as ProsemirrorNode,
  NodeSpec,
  NodeType,
} from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Plugin, TextSelection } from "prosemirror-state";
import * as React from "react";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import { s } from "../../styles";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import type { ComponentProps } from "../types";
import Node from "./Node";

interface DropdownOption {
  id: string;
  label: string;
  color: string;
}

interface DropdownAttrs {
  id: string;
  name: string;
  selectedOptionId: string;
  options: DropdownOption[];
}

const defaultOptions: DropdownOption[] = [
  {
    id: "design",
    label: "Design",
    color: "#9E77ED",
  },
  {
    id: "open",
    label: "Open Issue",
    color: "#BA1A1A",
  },
  {
    id: "progress",
    label: "In Progress",
    color: "#D9793D",
  },
  {
    id: "qa",
    label: "QA",
    color: "#276678",
  },
  {
    id: "solved",
    label: "Solved",
    color: "#17834F",
  },
  {
    id: "ignored",
    label: "Ignored",
    color: "#6B7280",
  },
  {
    id: "ready-to-test",
    label: "Ready To Test",
    color: "#4F46E5",
  },
];

function getDefaultAttrs(): DropdownAttrs {
  return {
    id: uuidv4(),
    name: "Status",
    selectedOptionId: defaultOptions[0].id,
    options: defaultOptions,
  };
}

function getOptions(value: unknown): DropdownOption[] {
  if (!Array.isArray(value)) {
    return defaultOptions;
  }

  const options = value.filter(
    (option): option is DropdownOption =>
      typeof option?.id === "string" &&
      typeof option.label === "string" &&
      typeof option.color === "string"
  );

  return options.length ? options : defaultOptions;
}

function parseOptions(value: string | undefined): DropdownOption[] {
  if (!value) {
    return defaultOptions;
  }

  try {
    return getOptions(JSON.parse(value));
  } catch (_err) {
    return defaultOptions;
  }
}

function getSelectedOption(attrs: Partial<DropdownAttrs>) {
  const options = getOptions(attrs.options);
  return (
    options.find((option) => option.id === attrs.selectedOptionId) ?? options[0]
  );
}

function DropdownComponent({ node, view, getPos, isEditable }: ComponentProps) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "Status";
  const options = getOptions(node.attrs.options);
  const selectedOption = getSelectedOption(node.attrs);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current?.contains(event.target as HTMLElement)) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
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
    const transaction = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      selectedOptionId: option.id,
    });

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
      {open && (
        <Menu role="menu" aria-label={name}>
          <MenuHeader>{name}</MenuHeader>
          {options.map((option) => (
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
        </Menu>
      )}
    </Wrapper>
  );
}

/**
 * Inline document dropdown chip with per-node options.
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
        name: {
          default: "Status",
          validate: "string",
        },
        selectedOptionId: {
          default: defaultOptions[0].id,
          validate: "string",
        },
        options: {
          default: defaultOptions,
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
            name: dom.dataset.name ?? "Status",
            selectedOptionId:
              dom.dataset.selectedOptionId ?? defaultOptions[0].id,
            options: parseOptions(dom.dataset.options),
          }),
        },
      ],
      toDOM: (node) => {
        const selectedOption = getSelectedOption(node.attrs);

        return [
          "span",
          {
            class: this.name,
            "data-id": node.attrs.id,
            "data-name": node.attrs.name,
            "data-selected-option-id": node.attrs.selectedOptionId,
            "data-options": JSON.stringify(getOptions(node.attrs.options)),
          },
          selectedOption.label,
        ];
      },
      leafText: (node) => getSelectedOption(node.attrs).label,
    };
  }

  component = DropdownComponent;

  get plugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          const tr = newState.tr;
          const existingIds = new Set<string>();
          let modified = false;

          tr.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) {
              return;
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

          return modified ? tr : null;
        },
      }),
    ];
  }

  commands({ type }: { type: NodeType }) {
    return (attrs: Partial<DropdownAttrs> = {}): Command =>
      (state, dispatch) => {
        const { selection } = state;
        const position = selection.from;

        const defaultAttrs = getDefaultAttrs();
        const options = getOptions(attrs.options ?? defaultAttrs.options);
        const selectedOption =
          options.find((option) => option.id === attrs.selectedOptionId) ??
          options[0];
        const node = type.create({
          ...defaultAttrs,
          ...attrs,
          id: attrs.id ?? defaultAttrs.id,
          options,
          selectedOptionId: selectedOption.id,
        });

        const transaction = state.tr.replaceSelectionWith(node);
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
    state.write(getSelectedOption(node.attrs).label);
  }
}

const Wrapper = styled.span`
  display: inline-flex;
  position: relative;
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

const Menu = styled.span`
  background: ${s("menuBackground")};
  border-radius: 6px;
  box-shadow: ${s("menuShadow")};
  display: grid;
  gap: 3px;
  left: 0;
  min-width: 180px;
  padding: 8px;
  position: absolute;
  top: calc(100% + 4px);
  z-index: 400;
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
