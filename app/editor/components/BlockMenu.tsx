import { DocumentIcon, EditIcon, PlusIcon, ShapesIcon } from "outline-icons";
import cloneDeep from "lodash/cloneDeep";
import { observer } from "mobx-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "prosemirror-view";
import Icon from "@shared/components/Icon";
import { getDocumentDropdownDefinitions } from "@shared/editor/lib/dropdowns";
import type { DropdownDefinition } from "@shared/editor/lib/dropdowns";
import type { MenuItem } from "@shared/editor/types";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import { TextHelper } from "@shared/utils/TextHelper";
import useCurrentUser from "~/hooks/useCurrentUser";
import useDictionary from "~/hooks/useDictionary";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import getMenuItems from "../menus/block";
import DropdownTemplateDialog from "./DropdownTemplateDialog";
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
  const { dialogs } = useStores();
  const { elementRef } = editor;
  const templateMenuItem = useTemplateMenuItem();
  const canManageWorkspaceDropdowns = !!user && !user.isGuest && !user.isViewer;
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
          const documentDefinitions = getDocumentDropdownDefinitions(
            editor.view.state.doc
          );
          const definitions = workspaceDropdownTemplates.map((definition) => ({
            definition,
            title: definition.name,
          }));

          const items: MenuItem[] = [
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
              disabled: !canManageWorkspaceDropdowns,
              onClick: () => {
                dialogs.openModal({
                  title: "New workspace dropdown",
                  width: 560,
                  content: (
                    <DropdownTemplateDialog
                      existingDefinitions={[
                        ...documentDefinitions,
                        ...workspaceDropdownTemplates,
                      ]}
                      onCancel={dialogs.closeAllModals}
                      onSubmit={async (definition) => {
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
                        editor.view.dispatch(
                          editor.view.state.tr.insertText(" ")
                        );
                        dialogs.closeAllModals();
                      }}
                    />
                  ),
                });
              },
            },
          ];

          if (workspaceDropdownTemplates.length) {
            items.push(
              { name: "separator" },
              ...workspaceDropdownTemplates.map((template) => ({
                name: "noop",
                title: `Edit ${template.name}...`,
                icon: <EditIcon />,
                keywords: `${template.name} edit dropdown rename options workspace`,
                disabled: !canManageWorkspaceDropdowns,
                onClick: () => {
                  dialogs.openModal({
                    title: `Edit ${template.name}`,
                    width: 560,
                    content: (
                      <DropdownTemplateDialog
                        definition={template}
                        existingDefinitions={[
                          ...documentDefinitions,
                          ...workspaceDropdownTemplates,
                        ]}
                        onCancel={dialogs.closeAllModals}
                        onSubmit={async (definition) => {
                          const response = await client.post(
                            "/dropdownTemplates.update",
                            {
                              id: template.id,
                              name: definition.name,
                              options:
                                getSerializableDropdownOptions(definition),
                            }
                          );
                          const workspaceDefinition = response.data;

                          updateDocumentDropdownDefinition(
                            editor.view,
                            workspaceDefinition
                          );

                          setWorkspaceDropdownTemplates((templates) =>
                            sortDropdownDefinitions(
                              templates.map((existingTemplate) =>
                                existingTemplate.id === workspaceDefinition.id
                                  ? workspaceDefinition
                                  : existingTemplate
                              )
                            )
                          );
                          dialogs.closeAllModals();
                        }}
                      />
                    ),
                  });
                },
              }))
            );
          }

          return items;
        },
      }) satisfies MenuItem,
    [canManageWorkspaceDropdowns, dialogs, editor, workspaceDropdownTemplates]
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

function updateDocumentDropdownDefinition(
  view: EditorView,
  definition: DropdownDefinition
) {
  const { state } = view;
  let transaction = state.tr;
  let modified = false;

  state.doc.descendants((node, pos) => {
    if (
      node.type.name === "dropdown_definition" &&
      node.attrs.id === definition.id
    ) {
      transaction = transaction.setNodeMarkup(pos, undefined, definition);
      modified = true;
      return;
    }

    if (
      node.type.name !== "dropdown" ||
      node.attrs.dropdownId !== definition.id
    ) {
      return;
    }

    const selectedOption =
      definition.options.find(
        (option) => option.id === node.attrs.selectedOptionId
      ) ?? definition.options[0];

    transaction = transaction.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      selectedOptionId: selectedOption.id,
      name: definition.name,
      options: definition.options,
    });
    modified = true;
  });

  if (modified) {
    view.dispatch(transaction);
  }
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

function sortDropdownDefinitions(definitions: DropdownDefinition[]) {
  return [...definitions].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

export default observer(BlockMenu);
