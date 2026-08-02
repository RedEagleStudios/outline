import * as React from "react";
import useMeasure from "react-use-measure";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

export default function Berrycast({
  attrs,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const normalizedUrl = attrs.href.replace(/\/$/, "");
  const [measureRef, { width }] = useMeasure();

  return (
    <>
      <div ref={measureRef} />
      <Frame
        style={style}
        isSelected={isSelected}
        isResizing={isResizing}
        viewportGating={viewportGating}
        src={`${normalizedUrl}/video-player`}
        title="Berrycast Embed"
        height={`${0.5625 * width}px`}
        border={false}
      />
    </>
  );
}
