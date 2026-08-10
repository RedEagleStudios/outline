import { useCallback, useRef, useState } from "react";
import styled from "styled-components";
import { richExtensions } from "@shared/editor/nodes";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Editor, { type Editor as EditorInstance } from "~/editor";
import useDictionary from "~/hooks/useDictionary";
import {
  createEditorStressFixture,
  editorStressBodyRows,
  editorStressDropdownCount,
  editorStressFixtureUrlMarker,
  editorStressImageCount,
} from "./editorStressFixture";

interface StructuralCounts {
  tables: number;
  bodyRows: number[];
  images: number;
  dropdowns: number;
  definitions: number;
}

/**
 * Renders the development-only, non-persistent production editor stress harness.
 *
 * @returns editor stress scene.
 */
export function EditorStress() {
  const dictionary = useDictionary();
  const editorRef = useRef<EditorInstance>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [fixture, setFixture] = useState(() => createEditorStressFixture());
  const [snapshotLength, setSnapshotLength] = useState<number>();
  const [counts, setCounts] = useState<StructuralCounts>();

  const updateDiagnostics = useCallback(() => {
    const instance = editorRef.current;
    if (!instance) {
      setCounts(undefined);
      return;
    }
    const tables: number[] = [];
    let images = 0;
    let dropdowns = 0;
    let definitions = 0;
    instance.view.state.doc.descendants((node) => {
      if (node.type.name === "table") {
        tables.push(node.childCount - 1);
      } else if (node.type.name === "image") {
        images += 1;
      } else if (node.type.name === "dropdown") {
        dropdowns += 1;
      } else if (node.type.name === "dropdown_definition") {
        definitions += 1;
      }
    });
    setCounts({
      tables: tables.length,
      bodyRows: tables,
      images,
      dropdowns,
      definitions,
    });
  }, []);

  const handleMountToggle = useCallback(
    () => setMounted((value) => !value),
    []
  );
  const handleReadOnlyToggle = useCallback(
    () => setReadOnly((value) => !value),
    []
  );
  const handleRegenerate = useCallback(() => {
    const next = generation + 1;
    setGeneration(next);
    setFixture(createEditorStressFixture({ generation: next }));
    setSnapshotLength(undefined);
  }, [generation]);
  const handleReset = useCallback(() => {
    setGeneration(0);
    setFixture(createEditorStressFixture());
    setSnapshotLength(undefined);
  }, []);
  const handleSerialize = useCallback(() => {
    const value = editorRef.current?.value();
    if (typeof value === "string") {
      setSnapshotLength(value.length);
    }
    updateDiagnostics();
  }, [updateDiagnostics]);
  const handleClickLink = useCallback(() => undefined, []);

  const activeResources =
    containerRef.current?.querySelectorAll(
      "img[src],video[src],iframe[src],embed[src]"
    ).length ?? 0;
  const fixtureTimings = performance
    .getEntriesByType("resource")
    .filter((entry) =>
      entry.name.includes(editorStressFixtureUrlMarker)
    ).length;
  const rendererCounts = Array.from(editorRef.current?.renderers ?? []).reduce<
    Record<string, number>
  >((result, renderer) => {
    const name = renderer.props.node.type.name;
    result[name] = (result[name] ?? 0) + 1;
    return result;
  }, {});

  return (
    <Scene title="Editor stress">
      <Heading>Editor stress</Heading>
      <Controls>
        <button type="button" onClick={handleMountToggle}>
          {mounted ? "Unmount" : "Mount"} editor
        </button>
        <button type="button" onClick={handleReadOnlyToggle}>
          {readOnly ? "Make editable" : "Make read-only"}
        </button>
        <button type="button" onClick={handleRegenerate}>
          Regenerate URLs
        </button>
        <button type="button" onClick={handleReset}>
          Reset
        </button>
        <button type="button" onClick={handleSerialize} disabled={!mounted}>
          Serialize snapshot
        </button>
      </Controls>
      <Diagnostics>
        <div>Editor mounted: {mounted ? "yes" : "no"}</div>
        <div>
          Expected: 8 tables [{editorStressBodyRows.join(", ")}],{" "}
          {editorStressImageCount} images, {editorStressDropdownCount}{" "}
          dropdowns, 1 definition
        </div>
        <div>
          Actual:{" "}
          {counts
            ? `${counts.tables} tables [${counts.bodyRows.join(", ")}], ${counts.images} images, ${counts.dropdowns} dropdowns, ${counts.definitions} definition`
            : "serialize to measure"}
        </div>
        <div>
          Canonical Markdown length: {snapshotLength ?? "not serialized"}
        </div>
        <div>Active media elements: {activeResources}</div>
        <div>NodeView renderers: {editorRef.current?.renderers.size ?? 0}</div>
        <div>NodeView renderers by type: {JSON.stringify(rendererCounts)}</div>
        <div>Fixture resource timings: {fixtureTimings}</div>
      </Diagnostics>
      <EditorSurface ref={containerRef}>
        {mounted && (
          <Editor
            key={generation}
            ref={editorRef}
            defaultValue={fixture}
            dictionary={dictionary}
            embeds={[]}
            extensions={richExtensions}
            onClickLink={handleClickLink}
            placeholder="Editor stress fixture"
            readOnly={readOnly}
            onInit={updateDiagnostics}
          />
        )}
      </EditorSurface>
    </Scene>
  );
}

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
`;

const Diagnostics = styled.div`
  font-family: monospace;
  margin-bottom: 16px;
`;

const EditorSurface = styled.div`
  min-height: 480px;
`;

export default EditorStress;
