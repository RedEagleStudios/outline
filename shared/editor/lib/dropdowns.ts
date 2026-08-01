import type MarkdownIt from "markdown-it";
import { Fragment, type Node as ProsemirrorNode } from "prosemirror-model";

export interface DropdownOption {
  id: string;
  label: string;
  color: string;
}

export interface DropdownDefinition {
  id: string;
  name: string;
  options: DropdownOption[];
}

export interface DropdownAttrs {
  id: string;
  dropdownId: string;
  selectedOptionId: string;
  name?: string;
  options?: DropdownOption[];
}

const dropdownDefinitionRegex = /^<!--\s*outline-dropdown\s+(\{.*\})\s*-->\s*$/;
const dropdownIdRegex = /^[^\s}|]+$/;
const documentDropdownDefinitions = new WeakMap<
  ProsemirrorNode,
  readonly DropdownDefinition[]
>();

export const defaultDropdownDefinition: DropdownDefinition = {
  id: "status",
  name: "Status",
  options: [
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
  ],
};

/**
 * Returns valid dropdown definitions, falling back to the default definition.
 *
 * @param value the untrusted definitions value.
 * @returns normalized dropdown definitions.
 */
export function getDropdownDefinitions(value: unknown): DropdownDefinition[] {
  if (!Array.isArray(value)) {
    return [defaultDropdownDefinition];
  }

  const definitions = value.filter(
    (definition): definition is DropdownDefinition =>
      typeof definition?.id === "string" &&
      dropdownIdRegex.test(definition.id) &&
      typeof definition.name === "string" &&
      isDropdownOptions(definition.options)
  );

  return definitions.length ? definitions : [defaultDropdownDefinition];
}

/**
 * Finds the dropdown definition referenced by dropdown attrs.
 *
 * @param doc the ProseMirror document node.
 * @param attrs the dropdown node attrs.
 * @returns the matching dropdown definition.
 */
export function getDropdownDefinition(
  doc: ProsemirrorNode,
  attrs: Partial<DropdownAttrs>
): DropdownDefinition {
  const definitions = getDocumentDropdownDefinitions(doc);
  const fallback = getLegacyDropdownDefinition(attrs);

  return (
    definitions.find((definition) => definition.id === attrs.dropdownId) ??
    fallback ??
    defaultDropdownDefinition
  );
}

/**
 * Returns dropdown definitions stored in a ProseMirror document.
 *
 * @param doc the ProseMirror document node.
 * @returns document dropdown definitions.
 */
export function getDocumentDropdownDefinitions(
  doc: ProsemirrorNode
): DropdownDefinition[] {
  const cachedDefinitions = documentDropdownDefinitions.get(doc);
  if (cachedDefinitions) {
    return [...cachedDefinitions];
  }

  const definitions: DropdownDefinition[] = [];

  doc.descendants((node) => {
    if (node.type.name !== "dropdown_definition") {
      return;
    }

    definitions.push(...getDropdownDefinitions([node.attrs]));
  });

  documentDropdownDefinitions.set(doc, definitions);
  return [...definitions];
}

/**
 * Returns all dropdown definitions needed to serialize a document.
 *
 * @param doc the ProseMirror document node.
 * @returns dropdown definitions stored in definition nodes or legacy chips.
 */
export function getSerializableDropdownDefinitions(doc: ProsemirrorNode) {
  const definitions = new Map<string, DropdownDefinition>();

  for (const definition of getDocumentDropdownDefinitions(doc)) {
    definitions.set(definition.id, definition);
  }

  doc.descendants((node) => {
    if (node.type.name !== "dropdown") {
      return;
    }

    const legacyDefinition = getLegacyDropdownDefinition(node.attrs);
    if (legacyDefinition && !definitions.has(legacyDefinition.id)) {
      definitions.set(legacyDefinition.id, legacyDefinition);
    }
  });

  return [...definitions.values()];
}

/**
 * Copies document-level dropdown definition details onto dropdown nodes.
 *
 * @param doc the ProseMirror document node.
 * @returns the document with hydrated dropdown attrs.
 */
export function hydrateDropdownNodes(doc: ProsemirrorNode) {
  const definitions = getDocumentDropdownDefinitions(doc);
  if (!definitions.length) {
    return doc;
  }

  const hydrateNode = (node: ProsemirrorNode): ProsemirrorNode => {
    if (node.type.name === "dropdown") {
      const definition = definitions.find(
        (candidate) => candidate.id === node.attrs.dropdownId
      );

      if (!definition) {
        return node;
      }

      return node.type.create(
        {
          ...node.attrs,
          name: definition.name,
          options: definition.options,
        },
        undefined,
        node.marks
      );
    }

    if (!node.content.size) {
      return node;
    }

    const children: ProsemirrorNode[] = [];
    node.content.forEach((child) => children.push(hydrateNode(child)));

    return node.type.create(
      node.attrs,
      Fragment.fromArray(children),
      node.marks
    );
  };

  return hydrateNode(doc);
}

/**
 * Finds the selected option for a dropdown node.
 *
 * @param definition the dropdown definition.
 * @param selectedOptionId the selected option id.
 * @returns the selected option.
 */
export function getSelectedDropdownOption(
  definition: DropdownDefinition,
  selectedOptionId: unknown
): DropdownOption {
  return (
    definition.options.find((option) => option.id === selectedOptionId) ??
    definition.options[0]
  );
}

/**
 * Serializes document dropdown definitions as Markdown comments.
 *
 * @param value the untrusted definitions value.
 * @returns markdown definition comments.
 */
export function serializeDropdownDefinitions(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  const definitions = getDropdownDefinitions(value);

  return definitions
    .map(
      (definition) => `<!-- outline-dropdown ${JSON.stringify(definition)} -->`
    )
    .join("\n");
}

/**
 * Appends dropdown definition nodes to a document fragment.
 *
 * @param doc the parsed ProseMirror document node.
 * @param fragment the parsed document content.
 * @param dropdowns the dropdown definitions to append.
 * @returns document content with dropdown definitions.
 */
export function appendDropdownDefinitionNodes(
  doc: ProsemirrorNode,
  fragment: Fragment,
  dropdowns: DropdownDefinition[]
) {
  const type = doc.type.schema.nodes.dropdown_definition;
  if (!type || !dropdowns.length) {
    return fragment;
  }

  return fragment.append(
    Fragment.fromArray(dropdowns.map((definition) => type.create(definition)))
  );
}

/**
 * Extracts dropdown definition comments from Markdown.
 *
 * @param markdown the markdown input.
 * @returns stripped markdown and parsed definitions.
 */
export function extractDropdownDefinitions(markdown: string): {
  markdown: string;
  dropdowns: DropdownDefinition[];
} {
  const dropdowns: DropdownDefinition[] = [];
  let inFence = false;
  const strippedMarkdown = markdown
    .split("\n")
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return true;
      }

      const match = inFence ? undefined : line.match(dropdownDefinitionRegex);
      if (!match) {
        return true;
      }

      const [, json] = match;
      const definition = parseDropdownDefinition(json);

      if (definition) {
        dropdowns.push(definition);
      }

      return false;
    })
    .join("\n");

  return { markdown: strippedMarkdown.trimStart(), dropdowns };
}

/**
 * Adds inline dropdown token support to Markdown parsing.
 *
 * @param md the markdown-it parser instance.
 */
export function dropdownMarkdownRule(md: MarkdownIt) {
  md.inline.ruler.before("emphasis", "dropdown", (state, silent) => {
    const start = state.pos;

    if (state.src.charCodeAt(start) !== 0x7b /* { */) {
      return false;
    }

    const match = state.src
      .slice(start)
      .match(/^\{dropdown:([^|}\s]+)\|([^}\s]+)\}/);
    if (!match) {
      return false;
    }

    if (!silent) {
      const token = state.push("dropdown", "", 0);
      token.attrSet("dropdownId", match[1]);
      token.attrSet("selectedOptionId", match[2]);
    }

    state.pos += match[0].length;
    return true;
  });
}

function getLegacyDropdownDefinition(
  attrs: Partial<DropdownAttrs>
): DropdownDefinition | undefined {
  if (!attrs.options || !isDropdownOptions(attrs.options)) {
    return undefined;
  }

  return {
    id: attrs.dropdownId || "legacy-dropdown",
    name: attrs.name ?? "Status",
    options: attrs.options,
  };
}

function isDropdownOptions(value: unknown): value is DropdownOption[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (option) =>
        typeof option?.id === "string" &&
        dropdownIdRegex.test(option.id) &&
        typeof option.label === "string" &&
        typeof option.color === "string"
    )
  );
}

function parseDropdownDefinition(value: string) {
  try {
    const parsed = JSON.parse(value);
    const definitions = getDropdownDefinitions([parsed]);
    return definitions[0];
  } catch (_err) {
    return undefined;
  }
}
