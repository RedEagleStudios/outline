import * as React from "react";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function Vimeo({
  matches,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const videoId = matches[4];
  const hId = matches[5];

  return (
    <Frame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      src={`https://player.vimeo.com/video/${videoId}?byline=0${
        hId ? `&h=${hId}` : ""
      }`}
      title={`Vimeo Embed (${videoId})`}
      height="412px"
      border={false}
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

export default Vimeo;
