import type {
  Node as ProsemirrorNode,
  NodeSpec,
  NodeType,
} from "prosemirror-model";
import type { Command } from "prosemirror-state";
import * as React from "react";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import Img from "../components/Img";
import Widget from "../components/Widget";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import type { ComponentProps } from "../types";
import Node from "./Node";

function ExcalidrawComponent(props: ComponentProps & { extension: Excalidraw }) {
  const { node, isSelected, extension } = props;
  const canEdit = Boolean(
    extension.editor.props.canUpdate && extension.editor.props.onOpenExcalidraw
  );

  const handleOpen = React.useCallback(() => {
    if (!canEdit || !extension.editor.props.onOpenExcalidraw) {
      return;
    }

    extension.editor.props.onOpenExcalidraw({
      node,
      getPos: props.getPos,
      view: props.view,
    });
  }, [canEdit, extension.editor.props, node, props.getPos, props.view]);

  const handleDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    handleOpen();
  };

  const rendered = extension.editor.props.renderExcalidraw?.({
    node,
    getPos: props.getPos,
    view: props.view,
    onDoubleClick: handleDoubleClick,
    onRequestEdit: canEdit ? handleOpen : undefined,
    isEditable: canEdit,
  });

  if (rendered) {
    return <>{rendered}</>;
  }

  return (
    <Widget
      icon={<ExcalidrawIcon src="/images/excalidraw-favicon-32.png" alt="" />}
      title={node.attrs.title || "Excalidraw drawing"}
      context={
        node.attrs.drawingRevisionId
          ? canEdit
            ? "Double-click to edit"
            : "Read-only drawing"
          : "Unsaved drawing"
      }
      href="#"
      isSelected={isSelected}
      onDoubleClick={canEdit ? handleDoubleClick : undefined}
      onClick={(event) => event.preventDefault()}
    />
  );
}

const ExcalidrawIcon = styled(Img)`
  width: 18px;
  height: 18px;
  border-radius: 4px;
`;

/**
 * A first-class Excalidraw drawing block backed by immutable drawing revisions.
 */
export default class Excalidraw extends Node {
  get name() {
    return "excalidraw";
  }

  get schema(): NodeSpec {
    return {
      group: "block",
      atom: true,
      selectable: true,
      draggable: true,
      attrs: {
        nodeId: { default: null, validate: "string|null" },
        drawingId: { default: null, validate: "string|null" },
        drawingRevisionId: { default: null, validate: "string|null" },
        previewRevisionId: { default: null, validate: "string|null" },
        title: { default: "Excalidraw drawing", validate: "string" },
        width: { default: 900, validate: "number|null" },
        height: { default: 420, validate: "number|null" },
      },
      parseDOM: [
        {
          tag: "div[data-type='excalidraw']",
          getAttrs: (dom: HTMLElement) => ({
            nodeId: dom.dataset.nodeId,
            drawingId: dom.dataset.drawingId,
            drawingRevisionId: dom.dataset.drawingRevisionId,
            previewRevisionId: dom.dataset.previewRevisionId,
            title: dom.dataset.title || "Excalidraw drawing",
            width: dom.dataset.width ? Number(dom.dataset.width) : null,
            height: dom.dataset.height ? Number(dom.dataset.height) : null,
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          "data-type": "excalidraw",
          "data-node-id": node.attrs.nodeId,
          "data-drawing-id": node.attrs.drawingId,
          "data-drawing-revision-id": node.attrs.drawingRevisionId,
          "data-preview-revision-id": node.attrs.previewRevisionId,
          "data-title": node.attrs.title,
          "data-width": node.attrs.width,
          "data-height": node.attrs.height,
          contentEditable: "false",
        },
        node.attrs.title || "Excalidraw drawing",
      ],
      leafText: (node) => `[${node.attrs.title || "Excalidraw drawing"}]`,
    };
  }

  commands({ type }: { type: NodeType }) {
    return {
      excalidraw:
        (): Command =>
        (state, dispatch) => {
          dispatch?.(
            state.tr
              .replaceSelectionWith(
                type.create({
                  nodeId: uuidv4(),
                  title: "Excalidraw drawing",
                  width: 900,
                  height: 420,
                })
              )
              .scrollIntoView()
          );
          return true;
        },
    };
  }

  component = (props: ComponentProps) => (
    <ExcalidrawComponent {...props} extension={this} />
  );

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.ensureNewLine();
    state.write(
      `[${state.esc(node.attrs.title || "Excalidraw drawing", false)}]`
    );
    state.write("\n\n");
  }
}
