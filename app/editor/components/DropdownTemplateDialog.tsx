import { PlusIcon, TrashIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import type { DropdownDefinition } from "@shared/editor/lib/dropdowns";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import InputColor from "~/components/InputColor";
import NudeButton from "~/components/NudeButton";
import Text from "~/components/Text";

interface Props {
  existingDefinitions: DropdownDefinition[];
  definition?: DropdownDefinition;
  onCancel: () => void;
  onSubmit: (definition: DropdownDefinition) => Promise<void>;
}

interface EditableOption {
  id?: string;
  label: string;
  color: string;
}

/**
 * Renders the workspace dropdown template editor.
 */
function DropdownTemplateDialog(props: Props) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(props.definition?.name ?? "Status");
  const [options, setOptions] = React.useState<EditableOption[]>(() =>
    (props.definition?.options ?? defaultOptions).map((option) => ({
      id: option.id,
      label: option.label,
      color: option.color,
    }))
  );
  const [isSaving, setIsSaving] = React.useState(false);

  const handleNameChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const handleOptionLabelChange = React.useCallback(
    (index: number, value: string) => {
      setOptions((currentOptions) =>
        currentOptions.map((option, optionIndex) =>
          optionIndex === index ? { ...option, label: value } : option
        )
      );
    },
    []
  );

  const handleOptionColorChange = React.useCallback(
    (index: number, value: string) => {
      setOptions((currentOptions) =>
        currentOptions.map((option, optionIndex) =>
          optionIndex === index ? { ...option, color: value } : option
        )
      );
    },
    []
  );

  const handleAddOption = React.useCallback(() => {
    setOptions((currentOptions) => [
      ...currentOptions,
      {
        label: "",
        color: dropdownColors[currentOptions.length % dropdownColors.length],
      },
    ]);
  }, []);

  const handleRemoveOption = React.useCallback((index: number) => {
    setOptions((currentOptions) =>
      currentOptions.filter((_option, optionIndex) => optionIndex !== index)
    );
  }, []);

  const definition = React.useMemo(
    () =>
      buildDropdownDefinition({
        name,
        options,
        existingDefinitions: props.existingDefinitions,
        existingDefinition: props.definition,
      }),
    [name, options, props.existingDefinitions, props.definition]
  );
  const isValid = !!definition;

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (!definition) {
        return;
      }

      setIsSaving(true);
      try {
        await props.onSubmit(definition);
      } catch (err) {
        toast.error(err.message);
        setIsSaving(false);
      }
    },
    [definition, props]
  );

  return (
    <form onSubmit={handleSubmit}>
      <FormStack gap={12} column>
        <Text type="secondary">
          {t("Create reusable dropdown options for the workspace.")}
        </Text>
        <Input
          label={t("Name")}
          value={name}
          onChange={handleNameChange}
          autoFocus
          required
          maxLength={100}
        />
        <OptionsHeader>
          <strong>{t("Options")}</strong>
          <Button
            type="button"
            neutral
            icon={<PlusIcon />}
            onClick={handleAddOption}
          >
            {t("Add option")}
          </Button>
        </OptionsHeader>
        <OptionsList>
          {options.map((option, index) => (
            <OptionRow key={option.id ?? index}>
              <Input
                label={t("Label")}
                value={option.label}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  handleOptionLabelChange(index, event.target.value)
                }
                required
                maxLength={100}
                margin={0}
              />
              <ColorField>
                <ColorInput
                  label={t("Color")}
                  value={option.color}
                  onChange={(value) => handleOptionColorChange(index, value)}
                  required
                  margin={0}
                />
              </ColorField>
              <RemoveButton
                type="button"
                aria-label={t("Remove option")}
                disabled={options.length === 1}
                onClick={() => handleRemoveOption(index)}
              >
                <TrashIcon />
              </RemoveButton>
            </OptionRow>
          ))}
        </OptionsList>
        <Actions justify="flex-end" gap={8}>
          <Button
            type="button"
            neutral
            onClick={props.onCancel}
            disabled={isSaving}
          >
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={!isValid || isSaving}>
            {isSaving ? t("Saving") : t("Save")}
          </Button>
        </Actions>
      </FormStack>
    </form>
  );
}

function buildDropdownDefinition({
  name,
  options,
  existingDefinitions,
  existingDefinition,
}: {
  name: string;
  options: EditableOption[];
  existingDefinitions: DropdownDefinition[];
  existingDefinition?: DropdownDefinition;
}): DropdownDefinition | undefined {
  const trimmedName = name.trim();
  const normalizedOptions = options.map((option) => ({
    ...option,
    label: option.label.trim(),
    color: option.color.trim(),
  }));

  if (
    !trimmedName ||
    !normalizedOptions.length ||
    normalizedOptions.some(
      (option) => !option.label || !/^#[0-9a-fA-F]{6}$/.test(option.color)
    )
  ) {
    return undefined;
  }

  const existingIds = new Set(
    existingDefinitions
      .filter((definition) => definition.id !== existingDefinition?.id)
      .map((definition) => definition.id)
  );
  const id =
    existingDefinition?.id ??
    getUniqueDropdownId(slugifyDropdownId(trimmedName), existingIds);
  const usedOptionIds = new Set<string>();

  return {
    id,
    name: trimmedName,
    options: normalizedOptions.map((option) => {
      const optionId =
        option.id && !usedOptionIds.has(option.id)
          ? option.id
          : getUniqueDropdownId(slugifyDropdownId(option.label), usedOptionIds);
      usedOptionIds.add(optionId);

      return {
        id: optionId,
        label: option.label,
        color: option.color,
      };
    }),
  };
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

const FormStack = styled(Flex)`
  width: 100%;
  min-width: 0;
`;

const OptionsHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const OptionsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ColorField = styled.div`
  min-width: 0;
`;

const ColorInput = styled(InputColor)`
  bottom: 5px;
`;

const OptionRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(124px, 144px) 28px;
  align-items: end;
  gap: 8px;

  @media (max-width: 520px) {
    grid-template-columns: minmax(0, 1fr) 28px;

    ${ColorField} {
      grid-column: 1 / -1;
    }
  }
`;

const RemoveButton = styled(NudeButton)`
  margin-bottom: 1px;
  color: ${(props) => props.theme.textSecondary};

  &:disabled {
    color: ${(props) => props.theme.textTertiary};
    cursor: default;
  }
`;

const Actions = styled(Flex)`
  margin-top: 4px;
`;

const defaultOptions: EditableOption[] = [
  { label: "Design", color: "#9E77ED" },
  { label: "Open Issue", color: "#BA1A1A" },
  { label: "In Progress", color: "#D9793D" },
  { label: "QA", color: "#276678" },
  { label: "Solved", color: "#17834F" },
];

const dropdownColors = [
  "#9E77ED",
  "#BA1A1A",
  "#D9793D",
  "#276678",
  "#17834F",
  "#6B7280",
  "#4F46E5",
];

export default DropdownTemplateDialog;
