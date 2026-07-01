import type { Node as ProsemirrorNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import styled from "styled-components";
import type { JSONObject } from "@shared/types";
import { ResizeBottom, ResizeRight } from "@shared/editor/components/ResizeHandle";
import useDragResize from "@shared/editor/components/hooks/useDragResize";
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
  scene: Partial<ExcalidrawScene>;
}

interface Props {
  node: ProsemirrorNode;
  getPos: () => number;
  view: EditorView;
  shareId?: string;
  onDoubleClick?: React.MouseEventHandler<HTMLElement>;
  onRequestEdit?: () => void;
  isEditable?: boolean;
}

interface ExcalidrawCanvasProps {
  initialData?: ExcalidrawScene & { scrollToContent?: boolean };
  viewModeEnabled?: boolean;
  zenModeEnabled?: boolean;
}

const ExcalidrawCanvas = lazyWithRetry<
  React.ComponentType<ExcalidrawCanvasProps>
>(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw as React.ComponentType<ExcalidrawCanvasProps>,
  }))
);

/**
 * Renders an embedded Excalidraw drawing in document view.
 *
 * @param props - component props.
 * @return the rendered drawing preview.
 */
export default function ExcalidrawViewer(props: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const revisionId = props.node.attrs.drawingRevisionId;
  const [scene, setScene] = React.useState<ExcalidrawScene | null>(null);
  const [isLoading, setIsLoading] = React.useState(Boolean(revisionId));
  const [failed, setFailed] = React.useState(false);
  const isEditable = Boolean(props.isEditable && props.onRequestEdit);
  const title = props.node.attrs.title || "Excalidraw drawing";
  const nodeWidth = Number(props.node.attrs.width) || 900;
  const nodeHeight = Number(props.node.attrs.height) || 420;
  const handleChangeSize = React.useCallback(
    ({ width, height }: { width: number; height?: number }) => {
      const pos = props.getPos();
      const transaction = props.view.state.tr
        .setNodeMarkup(pos, undefined, {
          ...props.node.attrs,
          width,
          height: height ?? nodeHeight,
        })
        .setMeta("addToHistory", true);
      props.view.dispatch(
        transaction.setSelection(NodeSelection.create(transaction.doc, pos))
      );
    },
    [nodeHeight, props]
  );
  const { width, height, handlePointerDown, dragging } = useDragResize({
    width: nodeWidth,
    height: nodeHeight,
    naturalWidth: 900,
    naturalHeight: 420,
    gridSnap: 5,
    gridHeightSnap: 20,
    minHeight: 240,
    onChangeSize: isEditable ? handleChangeSize : undefined,
    ref: containerRef,
  });
  const hintId = React.useMemo(
    () => `excalidraw-viewer-hint-${revisionId ?? props.node.attrs.nodeId ?? "view"}`,
    [props.node.attrs.nodeId, revisionId]
  );
  const reservedSize = React.useMemo(
    () => ({ width, height }),
    [height, width]
  );

  React.useEffect(() => {
    let isMounted = true;

    if (!revisionId) {
      setScene(null);
      setFailed(false);
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setScene(null);
    setFailed(false);
    setIsLoading(true);

    const load = async () => {
      try {
        const response = await client.post<{ data: DrawingRevision }>(
          "/excalidraw.info",
          {
            id: revisionId,
            shareId: props.shareId,
          }
        );

        if (isMounted) {
          setScene(normalizeScene(response.data.scene));
        }
      } catch {
        if (isMounted) {
          setFailed(true);
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
  }, [props.shareId, revisionId]);

  if (!revisionId) {
    return (
      <StateSurface
        $interactive={isEditable}
        style={reservedSize}
        role={isEditable ? "button" : undefined}
        tabIndex={isEditable ? 0 : undefined}
        onDoubleClick={isEditable ? props.onDoubleClick : undefined}
        onKeyDown={handleKeyDown(props.onRequestEdit)}
        aria-label="Unsaved Excalidraw drawing"
        aria-describedby={isEditable ? hintId : undefined}
      >
        <StateTitle>Unsaved drawing</StateTitle>
        <StateText>Finish editing and save to create a revision.</StateText>
        {isEditable ? <Hint id={hintId}>Double-click to edit.</Hint> : null}
      </StateSurface>
    );
  }

  if (isLoading) {
    return (
      <StateSurface
        $interactive={false}
        style={reservedSize}
        aria-busy="true"
      >
        <StateTitle>Loading drawing…</StateTitle>
        <StateText>Preparing the latest revision.</StateText>
      </StateSurface>
    );
  }

  if (failed) {
    return (
      <StateSurface
        $interactive={false}
        style={reservedSize}
        aria-live="polite"
      >
        <StateTitle>Unable to load drawing</StateTitle>
        <StateText>Try reopening the document.</StateText>
      </StateSurface>
    );
  }

  if (!scene) {
    return (
      <StateSurface
        $interactive={false}
        style={reservedSize}
        aria-busy="true"
      >
        <StateTitle>Loading drawing…</StateTitle>
        <StateText>Preparing the latest revision.</StateText>
      </StateSurface>
    );
  }

  if (!scene.elements || scene.elements.length === 0) {
    return (
      <StateSurface
        $interactive={isEditable}
        style={reservedSize}
        role={isEditable ? "button" : undefined}
        tabIndex={isEditable ? 0 : undefined}
        onDoubleClick={isEditable ? props.onDoubleClick : undefined}
        onKeyDown={handleKeyDown(props.onRequestEdit)}
        aria-label="Empty Excalidraw drawing"
        aria-describedby={isEditable ? hintId : undefined}
      >
        <StateTitle>Empty drawing</StateTitle>
        <StateText>Open it to start adding shapes.</StateText>
        {isEditable ? <Hint id={hintId}>Double-click to edit.</Hint> : null}
      </StateSurface>
    );
  }

  const sceneForPreview = {
    ...scene,
    scrollToContent: true,
    appState: {
      ...scene.appState,
      viewBackgroundColor: scene.appState.viewBackgroundColor ?? "#ffffff",
    },
  };

  return (
    <Surface
      ref={containerRef}
      $interactive={isEditable}
      style={{ width, height }}
      role={isEditable ? "button" : undefined}
      tabIndex={isEditable ? 0 : undefined}
      onDoubleClick={isEditable ? props.onDoubleClick : undefined}
      onKeyDown={handleKeyDown(props.onRequestEdit)}
      aria-label={title}
      aria-describedby={isEditable ? hintId : undefined}
    >
      <CanvasFrame>
        <React.Suspense fallback={<LoadingState>Loading drawing…</LoadingState>}>
          <ExcalidrawCanvas
            initialData={sceneForPreview}
            viewModeEnabled
            zenModeEnabled
          />
        </React.Suspense>
      </CanvasFrame>
      {isEditable ? (
        <>
          <ResizeRight
            $dragging={dragging}
            onPointerDown={handlePointerDown("right")}
          />
          <ResizeBottom
            $dragging={dragging}
            onPointerDown={handlePointerDown("bottom")}
          />
        </>
      ) : null}
      {isEditable ? <Hint id={hintId}>Double-click to edit.</Hint> : null}
    </Surface>
  );
}

function normalizeScene(scene: Partial<ExcalidrawScene>): ExcalidrawScene {
  return {
    type: "excalidraw",
    version: scene.version ?? 2,
    source: scene.source ?? "outline",
    elements: scene.elements ?? [],
    appState: scene.appState ?? {},
    files: {},
  };
}

function handleKeyDown(onRequestEdit?: () => void) {
  return (event: React.KeyboardEvent<HTMLElement>) => {
    if (!onRequestEdit) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onRequestEdit();
  };
}

const Surface = styled.div<{ $interactive: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  padding: 12px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 12px;
  background: linear-gradient(
    180deg,
    ${(props) => props.theme.background},
    ${(props) => props.theme.backgroundSecondary}
  );
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover {
    border-color: ${(props) =>
      props.$interactive ? props.theme.textTertiary : props.theme.divider};
    box-shadow: ${(props) =>
      props.$interactive ? "0 8px 24px rgba(0, 0, 0, 0.08)" : "0 1px 2px rgba(0, 0, 0, 0.04)"};
    transform: ${(props) => (props.$interactive ? "translateY(-1px)" : "none")};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.inputBorderFocused};
    outline-offset: 2px;
  }
`;

const StateSurface = styled(Surface)`
  justify-content: center;
  align-items: center;
  text-align: center;
`;

const CanvasFrame = styled.div`
  position: relative;
  flex: 1;
  min-height: 240px;
  overflow: hidden;
  border-radius: 10px;
  background: #fff;

  .excalidraw,
  .excalidraw-container {
    height: 100%;
    min-height: 100%;
  }

  .excalidraw .layer-ui__wrapper,
  .excalidraw .layer-ui__wrapper__footer,
  .excalidraw .layer-ui__wrapper__footer-left,
  .excalidraw .layer-ui__wrapper__footer-right,
  .excalidraw .layer-ui__wrapper__top-right,
  .excalidraw .App-menu,
  .excalidraw .App-menu_bottom,
  .excalidraw .App-bottom-bar,
  .excalidraw .App-mobile-menu,
  .excalidraw .App-toolbar,
  .excalidraw .App-toolbar-container,
  .excalidraw .main-menu-trigger,
  .excalidraw .dropdown-menu,
  .excalidraw .Island,
  .excalidraw .help-icon {
    display: none !important;
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

const StateTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
`;

const StateText = styled.div`
  max-width: 28rem;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.5;
`;

const Hint = styled.div`
  margin-top: 6px;
  color: ${(props) => props.theme.textTertiary};
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
`;
