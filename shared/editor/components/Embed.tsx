import * as React from "react";
import styled from "styled-components";
import type { EmbedDescriptor } from "../embeds";
import { getMatchingEmbed } from "../lib/embeds";
import type { ComponentProps } from "../types";
import DisabledEmbed from "./DisabledEmbed";
import Frame from "./Frame";
import { ResizeBottom, ResizeLeft, ResizeRight } from "./ResizeHandle";
import useDragResize from "./hooks/useDragResize";

type Props = ComponentProps & {
  embeds: EmbedDescriptor[];
  embedsDisabled?: boolean;
  style?: React.CSSProperties;
  onChangeSize?: (props: { width: number; height?: number }) => void;
  /** Whether generic iframe embeds should use viewport resource gating. */
  viewportGating?: boolean;
};

const Embed = (props: Props) => {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const { node, isEditable, embedsDisabled, onChangeSize } = props;
  const naturalWidth = 0;
  const naturalHeight = 400;
  const isResizable = !!onChangeSize && !embedsDisabled;

  const { width, height, setSize, handlePointerDown, dragging } = useDragResize(
    {
      width: node.attrs.width ?? naturalWidth,
      height: node.attrs.height ?? naturalHeight,
      naturalWidth,
      naturalHeight,
      gridSnap: 5,
      onChangeSize,
      ref: wrapperRef,
    }
  );

  React.useEffect(() => {
    if (node.attrs.height) {
      setSize({
        width: node.attrs.width,
        height: node.attrs.height,
      });
    }
  }, [node.attrs.height, node.attrs.width, setSize]);

  const style: React.CSSProperties = {
    width: width || "100%",
    height: height || 400,
    maxWidth: "100%",
    pointerEvents: dragging ? "none" : "all",
  };

  return (
    <FrameWrapper ref={wrapperRef}>
      <InnerEmbed style={style} {...props} dragging={dragging} />
      {isEditable && isResizable && (
        <>
          <ResizeBottom
            onPointerDown={handlePointerDown("bottom")}
            $dragging={!!dragging}
          />
        </>
      )}
    </FrameWrapper>
  );
};

interface InnerEmbedProps extends Props {
  dragging: boolean;
}

const InnerEmbed = ({
  isEditable,
  isSelected,
  node,
  embeds,
  embedsDisabled,
  style,
  viewportGating,
  dragging,
}: InnerEmbedProps) => {
  const cache = React.useMemo(
    () => getMatchingEmbed(embeds, node.attrs.href),
    [embeds, node.attrs.href]
  );

  if (!cache) {
    return null;
  }

  const { embed, matches } = cache;

  if (embedsDisabled) {
    return (
      <DisabledEmbed
        href={node.attrs.href}
        embed={embed}
        isEditable={isEditable}
        isSelected={isSelected}
      />
    );
  }

  if (embed.transformMatch) {
    const src = embed.transformMatch(matches);
    return (
      <Frame
        src={src}
        style={style}
        isSelected={isSelected}
        isResizing={dragging}
        viewportGating={viewportGating}
        canonicalUrl={embed.hideToolbar ? undefined : node.attrs.href}
        title={embed.title}
        referrerPolicy="strict-origin-when-cross-origin"
        border
      />
    );
  }

  if (embed.component) {
    const CustomEmbed = embed.component;
    return (
      <CustomEmbed
        attrs={{ href: node.attrs.href }}
        style={style}
        matches={matches}
        isEditable={isEditable}
        isSelected={isSelected}
        isResizing={dragging}
        viewportGating={viewportGating}
        embed={embed}
      />
    );
  }

  return null;
};

const FrameWrapper = styled.div`
  line-height: 0;
  position: relative;
  margin-left: auto;
  margin-right: auto;
  white-space: nowrap;
  cursor: default;
  border-radius: 8px;
  user-select: none;
  max-width: 100%;

  transition-property: width, max-height;
  transition-duration: 150ms;
  transition-timing-function: ease-in-out;

  &:hover {
    ${ResizeLeft}, ${ResizeRight} {
      opacity: 1;
    }
  }
`;

export default Embed;
