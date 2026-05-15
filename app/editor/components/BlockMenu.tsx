import { DocumentIcon, PlusIcon, ShapesIcon } from "outline-icons";
import cloneDeep from "lodash/cloneDeep";
import { observer } from "mobx-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "@shared/components/Icon";
import {
  defaultDropdownDefinition,
  getDocumentDropdownDefinitions,
} from "@shared/editor/lib/dropdowns";
import type { DropdownDefinition } from "@shared/editor/lib/dropdowns";
import type { MenuItem } from "@shared/editor/types";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import { TextHelper } from "@shared/utils/TextHelper";
import useCurrentUser from "~/hooks/useCurrentUser";
import useDictionary from "~/hooks/useDictionary";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import getMenuItems from "../menus/block";
import { useEditor } from "./EditorContext";
import type { Props as SuggestionsMenuProps } from "./SuggestionsMenu";
import SuggestionsMenu from "./SuggestionsMenu";
import SuggestionsMenuItem from "./SuggestionsMenuItem";

/**
 * Hook that returns a template menu item with children for inserting template
 * content into the editor, or undefined if no templates are available.
 */
function useTemplateMenuItem(): MenuItem | undefined {
  const { t } = useTranslation();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const { documents, templates: templatesStore } = useStores();
  const editor = useEditor();
  const documentId = editor.props.id;
  const document = documentId ? documents.get(documentId) : undefined;
  const collectionId = document?.collectionId;

  return useMemo(() => {
    if (!user) {
      return undefined;
    }

    const allTemplates = templatesStore.orderedData.filter(
      (template) => template.isActive
    );
    const hasTemplates = allTemplates.some(
      (template) =>
        template.isWorkspaceTemplate || template.collectionId === collectionId
    );

    if (!hasTemplates) {
      return undefined;
    }

    const toMenuItem = (template: (typeof allTemplates)[0]): MenuItem => ({
      name: "noop",
      title: TextHelper.replaceTemplateVariables(
        template.titleWithDefault,
        user
      ),
      icon: template.icon ? (
        <Icon
          value={template.icon}
          initial={template.initial}
          color={template.color ?? undefined}
        />
      ) : (
        <DocumentIcon />
      ),
      keywords: template.titleWithDefault,
      onClick: () => {
        const data = cloneDeep(template.data);
        ProsemirrorHelper.replaceTemplateVariables(data, user);
        editor.insertContent(data);
      },
    });

    const children = (): MenuItem[] => {
      const collectionTemplates = allTemplates.filter(
        (template) =>
          !template.isWorkspaceTemplate &&
          template.collectionId === collectionId
      );
      const workspaceTemplates = allTemplates.filter(
        (tmpl) => tmpl.isWorkspaceTemplate
      );

      const items: MenuItem[] = collectionTemplates.map(toMenuItem);

      if (collectionTemplates.length && workspaceTemplates.length) {
        items.push({ name: "separator" });
      }

      if (workspaceTemplates.length) {
        for (const template of workspaceTemplates) {
          items.push(toMenuItem(template));
        }
      }

      return items;
    };

    return {
      name: "noop",
      title: t("Templates"),
      icon: <ShapesIcon />,
      keywords: "template",
      children,
    } satisfies MenuItem;
  }, [user, templatesStore.orderedData, collectionId, editor, t]);
}

type Props = Omit<SuggestionsMenuProps, "renderMenuItem" | "items"> &
  Required<Pick<SuggestionsMenuProps, "embeds">>;

function BlockMenu(props: Props) {
  const dictionary = useDictionary();
  const editor = useEditor();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const { elementRef } = editor;
  const templateMenuItem = useTemplateMenuItem();
  const [workspaceDropdownTemplates, setWorkspaceDropdownTemplates] = useState<
    DropdownDefinition[]
  >([]);

  useEffect(() => {
    let didCancel = false;

    void client
      .post("/dropdownTemplates.list")
      .then((response) => {
        if (didCancel) {
          return;
        }

        setWorkspaceDropdownTemplates(response.data ?? []);
      })
      .catch(() => {
        if (!didCancel) {
          setWorkspaceDropdownTemplates([]);
        }
      });

    return () => {
      didCancel = true;
    };
  }, []);

  const dropdownMenuItem = useMemo(
    () =>
      ({
        name: "noop",
        title: "Dropdown",
        icon: <PlusIcon />,
        keywords: "select status chip pill options",
        children: () => {
          const documentDefinitions = getDropdownMenuDefinitions(
            getDocumentDropdownDefinitions(editor.view.state.doc)
          );
          const workspaceDefinitions = workspaceDropdownTemplates.filter(
            (template) =>
              !documentDefinitions.some(
                (definition) => definition.id === template.id
              )
          );
          const definitions = [
            ...documentDefinitions.map((definition) => ({
              definition,
              title: definition.name,
            })),
            ...workspaceDefinitions.map((definition) => ({
              definition,
              title: `${definition.name} (workspace)`,
            })),
          ];

          return [
            ...definitions.map(({ definition, title }) => ({
              name: "noop",
              title,
              keywords: `${definition.name} dropdown select status chip pill options`,
              onClick: () => {
                editor.commands.dropdown({
                  definition,
                  selectedOptionId: definition.options[0].id,
                });
                editor.view.dispatch(editor.view.state.tr.insertText(" "));
              },
            })),
            { name: "separator" },
            {
              name: "noop",
              title: "New workspace dropdown...",
              icon: <PlusIcon />,
              keywords: "new dropdown create select options workspace",
              disabled: !user?.isAdmin,
              onClick: async () => {
                const definition = promptForDropdownDefinition([
                  ...documentDefinitions,
                  ...workspaceDropdownTemplates,
                ]);

                if (!definition) {
                  return;
                }

                const response = await client.post(
                  "/dropdownTemplates.create",
                  {
                    name: definition.name,
                    options: getSerializableDropdownOptions(definition),
                  }
                );
                const workspaceDefinition = response.data;

                setWorkspaceDropdownTemplates((templates) => [
                  workspaceDefinition,
                  ...templates.filter(
                    (template) => template.id !== workspaceDefinition.id
                  ),
                ]);

                editor.commands.dropdown({
                  definition: workspaceDefinition,
                  selectedOptionId: workspaceDefinition.options[0].id,
                });
                editor.view.dispatch(editor.view.state.tr.insertText(" "));
              },
            },
          ];
        },
      }) satisfies MenuItem,
    [editor, user?.isAdmin, workspaceDropdownTemplates]
  );

  const items = useMemo(() => {
    const baseItems = getMenuItems(dictionary, elementRef).map((item) =>
      item.name === "dropdown" ? dropdownMenuItem : item
    );

    if (!templateMenuItem) {
      return baseItems;
    }

    return [...baseItems, { name: "separator" } as MenuItem, templateMenuItem];
  }, [dictionary, dropdownMenuItem, elementRef, templateMenuItem]);

  const renderMenuItem = useCallback(
    (item, _index, options) => (
      <SuggestionsMenuItem
        {...options}
        icon={item.icon}
        title={item.title}
        shortcut={item.shortcut}
        disabled={item.disabled}
        disclosure={options.disclosure}
      />
    ),
    []
  );

  return (
    <SuggestionsMenu
      {...props}
      filterable
      trigger="/"
      renderMenuItem={renderMenuItem}
      items={items}
    />
  );
}

function getDropdownMenuDefinitions(definitions: DropdownDefinition[]) {
  if (
    definitions.some(
      (definition) => definition.id === defaultDropdownDefinition.id
    )
  ) {
    return definitions;
  }

  return [defaultDropdownDefinition, ...definitions];
}

function promptForDropdownDefinition(
  existingDefinitions: DropdownDefinition[]
): DropdownDefinition | undefined {
  const name = window.prompt("Dropdown name", "Status")?.trim();

  if (!name) {
    return undefined;
  }

  const optionsValue = window
    .prompt(
      "Options, separated by commas. Add colors with Label=#RRGGBB",
      "Design=#9E77ED, Open Issue=#BA1A1A, In Progress=#D9793D, QA=#276678, Solved=#17834F"
    )
    ?.trim();

  if (!optionsValue) {
    return undefined;
  }

  const options = optionsValue
    .split(",")
    .map(parseDropdownOptionInput)
    .filter((option) => !!option.label);

  if (!options.length) {
    return undefined;
  }

  const existingIds = new Set(
    existingDefinitions.map((definition) => definition.id)
  );
  const id = getUniqueDropdownId(slugifyDropdownId(name), existingIds);
  const usedOptionIds = new Set<string>();

  return {
    id,
    name,
    options: options.map((option, index) => {
      const optionId = getUniqueDropdownId(
        slugifyDropdownId(option.label),
        usedOptionIds
      );
      usedOptionIds.add(optionId);

      return {
        id: optionId,
        label: option.label,
        color: option.color ?? dropdownColors[index % dropdownColors.length],
      };
    }),
  };
}

function parseDropdownOptionInput(value: string) {
  const [label, color] = value.split("=").map((part) => part.trim());

  return {
    label,
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined,
  };
}

function getSerializableDropdownOptions(definition: DropdownDefinition) {
  const options: Record<string, string>[] = definition.options.map(
    (option) => ({
      id: option.id,
      label: option.label,
      color: option.color,
    })
  );

  return options;
}

function getUniqueDropdownId(id: string, existingIds: Set<string>) {
  let candidate = id || "dropdown";
  let index = 2;

  while (existingIds.has(candidate)) {
    candidate = `${id}-${index}`;
    index += 1;
  }

  return candidate;
}

function slugifyDropdownId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const dropdownColors = [
  "#9E77ED",
  "#BA1A1A",
  "#D9793D",
  "#276678",
  "#17834F",
  "#6B7280",
  "#4F46E5",
];

export default observer(BlockMenu);
