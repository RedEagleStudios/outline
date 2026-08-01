import { defaultDropdownDefinition } from "@shared/editor/lib/dropdowns";
import type { ProsemirrorData, ProsemirrorDoc } from "@shared/types";

export const editorStressBodyRows = [93, 10, 3, 19, 5, 10, 119, 35] as const;
export const editorStressImageCount = 143;
export const editorStressDropdownCount = 576;
export const editorStressFixtureUrlMarker = "editor-stress-fixture";

export interface EditorStressFixtureOptions {
  generation?: number;
}

const totalBodyRows = editorStressBodyRows.reduce(
  (total, count) => total + count,
  0
);

const paragraph = (content: ProsemirrorData[]): ProsemirrorData => ({
  type: "paragraph",
  content,
});

const text = (value: string): ProsemirrorData => ({
  type: "text",
  text: value,
});

/**
 * Creates the deterministic structured document used by the editor stress page.
 *
 * @param options fixture generation options.
 * @returns generated ProseMirror document with the fixed QA shape.
 */
export function createEditorStressFixture(
  options: EditorStressFixtureOptions = {}
): ProsemirrorDoc {
  const generation = options.generation ?? 0;
  const content: ProsemirrorData[] = [
    paragraph([text("Editor stress typing sentinel: top")]),
    {
      type: "dropdown_definition",
      attrs: {
        id: defaultDropdownDefinition.id,
        name: defaultDropdownDefinition.name,
        options: defaultDropdownDefinition.options.map((option) => ({
          id: option.id,
          label: option.label,
          color: option.color,
        })),
      },
    },
  ];
  let rowIndex = 0;
  let imageIndex = 0;
  let dropdownIndex = 0;

  editorStressBodyRows.forEach((bodyRows, tableIndex) => {
    const rows: ProsemirrorData[] = [
      {
        type: "tr",
        content: ["item", "Media", "Status"].map((label) => ({
          type: "th",
          content: [
            paragraph([
              text(label === "item" ? `Table ${tableIndex + 1} item` : label),
            ]),
          ],
        })),
      },
    ];

    for (let tableRow = 0; tableRow < bodyRows; tableRow += 1) {
      const media: ProsemirrorData[] = [];
      const statuses: ProsemirrorData[] = [];

      if (imageIndex < editorStressImageCount) {
        const number = imageIndex + 1;
        media.push({
          type: "image",
          attrs: {
            src: `/images/icon-192.png?${editorStressFixtureUrlMarker}=g${generation}-i${number}`,
            width: 192,
            height: 192,
            alt: `QA fixture image ${number}`,
          },
        });
        imageIndex += 1;
      } else {
        media.push(text(`Media placeholder ${rowIndex + 1}`));
      }

      const remainingRows = totalBodyRows - rowIndex;
      const remainingDropdowns = editorStressDropdownCount - dropdownIndex;
      const countForRow = Math.ceil(remainingDropdowns / remainingRows);
      for (let index = 0; index < countForRow; index += 1) {
        statuses.push({
          type: "dropdown",
          attrs: {
            id: `editor-stress-dropdown-${dropdownIndex + 1}`,
            dropdownId: defaultDropdownDefinition.id,
            selectedOptionId:
              defaultDropdownDefinition.options[
                dropdownIndex % defaultDropdownDefinition.options.length
              ].id,
          },
        });
        dropdownIndex += 1;
      }

      rows.push({
        type: "tr",
        content: [
          paragraph([text(`Row ${rowIndex + 1}`)]),
          paragraph(media),
          paragraph(statuses),
        ].map((cellContent) => ({ type: "td", content: [cellContent] })),
      });
      rowIndex += 1;
    }
    content.push({ type: "table", content: rows });

    if (tableIndex === 3) {
      content.push(paragraph([text("Editor stress typing sentinel: middle")]));
    }
  });

  content.push(paragraph([text("Editor stress typing sentinel: bottom")]));
  return { type: "doc", content };
}
