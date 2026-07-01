import type { Node as ProsemirrorNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import type { JSONObject } from "@shared/types";
import Button from "~/components/Button";
import { client } from "~/utils/ApiClient";
import lazyWithRetry from "~/utils/lazyWithRetry";
import "@excalidraw/excalidraw/index.css";

interface ExcalidrawScene {
  type: "excalidraw";
  version: number;
  source: string;
  elements: object[];
  appState: JSONObject;
  files: Record<string, object>;
}

interface DrawingRevision {
  id: string;
  drawingId: string;
  scene: Partial<ExcalidrawScene>;
  preview: string | null;
}

interface Props {
  documentId: string;
  node: ProsemirrorNode;
  getPos: () => number;
  view: EditorView;
  onClose: () => void;
  onSaveDocument: () => Promise<void> | void;
}

type ExcalidrawChangeHandler = (
  elements: readonly object[],
  appState: JSONObject,
  files: Record<string, object>
) => void;

type SaveStatus = "idle" | "pending" | "saving" | "saved";

interface ExcalidrawCanvasProps {
  initialData?: ExcalidrawScene;
  onChange?: ExcalidrawChangeHandler;
  viewModeEnabled?: boolean;
}

const ExcalidrawCanvas = lazyWithRetry<
  React.ComponentType<ExcalidrawCanvasProps>
>(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw as React.ComponentType<ExcalidrawCanvasProps>,
  }))
);

const emptyScene: ExcalidrawScene = {
  type: "excalidraw",
  version: 2,
  source: "outline",
  elements: [],
  appState: {},
  files: {},
};

const appStateKeys = [
  "viewBackgroundColor",
  "gridSize",
  "name",
  "theme",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
] as const;

function cleanAppState(appState: JSONObject): JSONObject {
  const clean: JSONObject = {};

  for (const key of appStateKeys) {
    const value = appState[key];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      clean[key] = value;
    }
  }

  return clean;
}

function normalizeScene(scene: Partial<ExcalidrawScene>): ExcalidrawScene {
  return {
    type: "excalidraw",
    version: scene.version ?? 2,
    source: scene.source ?? "outline",
    elements: scene.elements ?? [],
    appState: cleanAppState(scene.appState ?? {}),
    files: {},
  };
}

function serializeScene(scene: ExcalidrawScene): JSONObject {
  return JSON.parse(JSON.stringify(scene));
}

async function refreshCsrfToken() {
  await fetch(window.location.href, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-cache",
  });
}

/**
 * Modal editor for an embedded Excalidraw drawing.
 *
 * @param props - component props.
 * @return the Excalidraw editor modal contents.
 */
export default function ExcalidrawDialog(props: Props) {
  const { documentId, getPos, node, onClose, onSaveDocument, view } = props;
  const [scene, setScene] = React.useState<ExcalidrawScene>(emptyScene);
  const [isLoading, setIsLoading] = React.useState(Boolean(node.attrs.drawingRevisionId));
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [reloadCount, setReloadCount] = React.useState(0);
  const baseDrawingRevisionIdRef = React.useRef<string | null>(
    node.attrs.drawingRevisionId ?? null
  );
  const drawingIdRef = React.useRef<string | null>(node.attrs.drawingId ?? null);
  const latestSceneRef = React.useRef<ExcalidrawScene>(emptyScene);
  const lastSavedSceneRef = React.useRef(JSON.stringify(serializeScene(emptyScene)));
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

  const handleRetry = React.useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    setEditError(null);
    setScene(emptyScene);
    setReloadCount((current) => current + 1);
  }, []);

  React.useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const revisionId = node.attrs.drawingRevisionId;
      if (!revisionId) {
        if (isMounted) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const response = await client.post<{ data: DrawingRevision }>(
          "/excalidraw.info",
          { id: revisionId }
        );

        if (isMounted) {
          setScene(normalizeScene(response.data.scene));
          latestSceneRef.current = normalizeScene(response.data.scene);
          lastSavedSceneRef.current = JSON.stringify(
            serializeScene(latestSceneRef.current)
          );
          baseDrawingRevisionIdRef.current = revisionId;
          drawingIdRef.current = response.data.drawingId;
          setSaveStatus("saved");
          setLoadError(null);
        }
      } catch {
        if (isMounted) {
          setLoadError("Unable to load the drawing.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [node.attrs.drawingRevisionId, reloadCount]);

  const handleChange = React.useCallback<ExcalidrawChangeHandler>(
    (elements, appState, files) => {
      if (Object.keys(files).length > 0) {
        setEditError(
          "Embedded image files are not supported in Excalidraw drawings yet."
        );
        return;
      }

      setEditError(null);
      const nextScene: ExcalidrawScene = {
        type: "excalidraw",
        version: 2,
        source: "outline",
        elements: [...elements],
        appState: cleanAppState(appState),
        files: {},
      };

      latestSceneRef.current = nextScene;
      setScene(nextScene);

      if (JSON.stringify(serializeScene(nextScene)) !== lastSavedSceneRef.current) {
        setSaveStatus("pending");
      }
    },
    []
  );

  const saveDrawing = React.useCallback(async () => {
    if (saveStatus === "saving") {
      return;
    }

    setSaveStatus("saving");
    setEditError(null);

    try {
      const sceneToSave: ExcalidrawScene = {
        ...latestSceneRef.current,
        appState: cleanAppState(latestSceneRef.current.appState),
        files: {},
      };
      const serializedScene = JSON.stringify(serializeScene(sceneToSave));
      const payload = {
          documentId,
          drawingId: drawingIdRef.current ?? uuidv4(),
          baseDrawingRevisionId: baseDrawingRevisionIdRef.current,
          scene: serializeScene(sceneToSave),
          preview: null,
      };
      let response: { data: DrawingRevision };
      try {
        response = await client.post<{ data: DrawingRevision }>(
          "/excalidraw.create",
          payload
        );
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === "CSRF token invalid, please try reloading."
        ) {
          await refreshCsrfToken();
          response = await client.post<{ data: DrawingRevision }>(
            "/excalidraw.create",
            payload
          );
        } else {
          throw err;
        }
      }

      const pos = getPos();
      if (typeof pos !== "number" || pos < 0) {
        setEditError("The drawing is no longer available in this document.");
        setSaveStatus("pending");
        return;
      }

      const currentNode = view.state.doc.nodeAt(pos);
      if (!currentNode || currentNode.type.name !== "excalidraw") {
        setEditError("The drawing is no longer available in this document.");
        setSaveStatus("pending");
        return;
      }
      if (currentNode.attrs.drawingRevisionId !== baseDrawingRevisionIdRef.current) {
        setEditError("The drawing changed while it was open. Please reopen it.");
        setSaveStatus("pending");
        return;
      }

      const tr = view.state.tr
        .setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          drawingId: response.data.drawingId,
          drawingRevisionId: response.data.id,
          previewRevisionId: response.data.preview ? response.data.id : null,
        })
        .setMeta("addToHistory", true);
      view.dispatch(
        tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView()
      );
      drawingIdRef.current = response.data.drawingId;
      baseDrawingRevisionIdRef.current = response.data.id;
      lastSavedSceneRef.current = serializedScene;
      try {
        await onSaveDocument();
      } catch {
        setEditError("The drawing was saved, but the document revision could not be saved.");
        return;
      }
      setSaveStatus(
        JSON.stringify(serializeScene(latestSceneRef.current)) === serializedScene
          ? "saved"
          : "pending"
      );
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Unable to save drawing.");
      setSaveStatus("pending");
    }
  }, [
    documentId,
    getPos,
    onSaveDocument,
    saveStatus,
    view,
  ]);

  React.useEffect(() => {
    if (saveStatus !== "pending" || editError || isLoading) {
      return;
    }

    saveTimeoutRef.current = setTimeout(() => {
      void saveDrawing();
    }, 1200);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editError, isLoading, saveDrawing, saveStatus]);

  if (isLoading) {
    return (
      <Container>
        <LoadingPanel>
          <PanelTitle>Loading drawing…</PanelTitle>
          <PanelText>Preparing the canvas and scene.</PanelText>
        </LoadingPanel>
      </Container>
    );
  }

  if (loadError) {
    return (
      <Container>
        <ErrorPanel role="alert">
          <PanelTitle>Couldn’t load the drawing</PanelTitle>
          <PanelText>{loadError}</PanelText>
        </ErrorPanel>
        <Actions>
          <Button type="button" neutral onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={handleRetry}>
            Try again
          </Button>
        </Actions>
      </Container>
    );
  }

  return (
    <Container>
      {editError ? (
        <ErrorPanel role="alert">
          <PanelTitle>Unable to save changes</PanelTitle>
          <PanelText>{editError}</PanelText>
        </ErrorPanel>
      ) : null}
      <Canvas>
        <React.Suspense fallback={<LoadingState>Loading editor…</LoadingState>}>
          <ExcalidrawCanvas
            initialData={scene}
            onChange={handleChange}
            viewModeEnabled={false}
          />
        </React.Suspense>
      </Canvas>
      <SaveStatusPill>{getSaveStatusText(saveStatus)}</SaveStatusPill>
    </Container>
  );
}

function getSaveStatusText(status: SaveStatus) {
  switch (status) {
    case "pending":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    default:
      return "Autosave on";
  }
}

const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
`;

const LoadingPanel = styled.div`
  display: flex;
  flex: 1;
  min-height: 420px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 12px;
  background: ${(props) => props.theme.backgroundSecondary};
`;

const ErrorPanel = styled.div`
  position: absolute;
  z-index: 2;
  top: 92px;
  left: 50%;
  width: min(520px, calc(100% - 32px));
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid ${(props) => props.theme.danger};
  border-radius: 10px;
  background: ${(props) => props.theme.backgroundSecondary};
`;

const Canvas = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: ${(props) => props.theme.background};

  .excalidraw,
  .excalidraw-container {
    height: 100%;
  }
`;

const LoadingState = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: ${(props) => props.theme.textSecondary};
`;

const Actions = styled.div`
  position: absolute;
  z-index: 2;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 10px;
  background: ${(props) => props.theme.modalBackground};
  box-shadow: ${(props) => props.theme.modalShadow};
`;

const SaveStatusPill = styled.div`
  position: absolute;
  z-index: 2;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  padding: 7px 12px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 999px;
  background: ${(props) => props.theme.modalBackground};
  box-shadow: ${(props) => props.theme.modalShadow};
  color: ${(props) => props.theme.textSecondary};
  font-size: 13px;
  font-weight: 500;
`;

const PanelTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
`;

const PanelText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.5;
`;
