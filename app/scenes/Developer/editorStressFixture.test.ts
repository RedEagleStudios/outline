import { defaultDropdownDefinition } from "@shared/editor/lib/dropdowns";
import { EditorState, TextSelection } from "prosemirror-state";
import { extensionManager, schema } from "@shared/test/editor";
import {
  createEditorStressFixture,
  editorStressBodyRows,
  editorStressDropdownCount,
  editorStressFixtureUrlMarker,
  editorStressImageCount,
} from "./editorStressFixture";

describe("createEditorStressFixture", () => {
  it("is deterministic and creates the exact QA shape", () => {
    const fixture = createEditorStressFixture();
    expect(createEditorStressFixture()).toEqual(fixture);
    expect(fixture.type).toBe("doc");

    const document = schema.nodeFromJSON(fixture);
    const serializer = extensionManager.serializer();
    const tableRows: number[] = [];
    const tableImages: number[] = [];
    const tableDropdowns: number[] = [];
    const imageUrls = new Set<string>();
    const dropdownIds = new Set<string>();
    const selectedOptionIds = new Set(
      defaultDropdownDefinition.options.map((option) => option.id)
    );
    let definitionCount = 0;

    document.forEach((node) => {
      if (node.type.name === "dropdown_definition") {
        definitionCount += 1;
        expect(node.attrs).toEqual(defaultDropdownDefinition);
      }
      if (node.type.name !== "table") {
        return;
      }

      tableRows.push(node.childCount - 1);
      let images = 0;
      let dropdowns = 0;
      node.descendants((descendant) => {
        if (descendant.type.name === "image") {
          images += 1;
          expect(descendant.attrs.width).toBe(192);
          expect(descendant.attrs.height).toBe(192);
          expect(descendant.attrs.alt).toMatch(/^QA fixture image \d+$/);
          expect(descendant.attrs.src).toContain(editorStressFixtureUrlMarker);
          imageUrls.add(descendant.attrs.src);
        } else if (descendant.type.name === "dropdown") {
          dropdowns += 1;
          expect(descendant.attrs.dropdownId).toBe(
            defaultDropdownDefinition.id
          );
          expect(selectedOptionIds.has(descendant.attrs.selectedOptionId)).toBe(
            true
          );
          dropdownIds.add(descendant.attrs.id);
        }
      });
      tableImages.push(images);
      tableDropdowns.push(dropdowns);
    });

    expect(tableRows).toEqual([...editorStressBodyRows]);
    expect(tableImages).toEqual([93, 10, 3, 19, 5, 10, 3, 0]);
    expect(tableDropdowns).toEqual([186, 20, 6, 38, 10, 20, 238, 58]);
    expect(imageUrls.size).toBe(editorStressImageCount);
    expect(dropdownIds.size).toBe(editorStressDropdownCount);
    expect(definitionCount).toBe(1);

    const topLevelParagraphs: string[] = [];
    document.forEach((node) => {
      if (node.type.name === "paragraph") {
        topLevelParagraphs.push(node.textContent);
      }
    });
    expect(topLevelParagraphs).toEqual([
      "Editor stress typing sentinel: top",
      "Editor stress typing sentinel: middle",
      "Editor stress typing sentinel: bottom",
    ]);
    expect(() => serializer.serialize(document)).not.toThrow();
    expect(serializer.serialize(document)).toEqual(expect.any(String));
  });

  it("changes only image URLs between generations", () => {
    const initial = createEditorStressFixture();
    const regenerated = createEditorStressFixture({ generation: 1 });
    const normalizeImageUrls = (value: typeof initial) =>
      JSON.stringify(value).replace(
        /editor-stress-fixture=g\d+-i/g,
        "editor-stress-fixture=gN-i"
      );

    expect(normalizeImageUrls(regenerated)).toBe(normalizeImageUrls(initial));
  });

  it("restores canonical serialization after a controlled sentinel edit", () => {
    const document = schema.nodeFromJSON(createEditorStressFixture());
    const serializer = extensionManager.serializer();
    const baseline = serializer.serialize(document);
    let sentinelEnd: number | undefined;
    document.descendants((node, position) => {
      if (node.text === "Editor stress typing sentinel: top") {
        sentinelEnd = position + node.nodeSize;
      }
    });
    if (sentinelEnd === undefined) {
      throw new Error("Expected the top typing sentinel");
    }

    const state = EditorState.create({
      schema,
      doc: document,
      selection: TextSelection.create(document, sentinelEnd),
    });
    const edited = state.apply(state.tr.insertText("!", sentinelEnd));
    const restored = edited.apply(
      edited.tr.delete(sentinelEnd, sentinelEnd + 1)
    );

    expect(serializer.serialize(restored.doc)).toBe(baseline);
  });
});
