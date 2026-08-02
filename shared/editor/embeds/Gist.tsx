import * as React from "react";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function Gist({ attrs, style, isSelected, isResizing, viewportGating }: Props) {
  return (
    <Frame
      src={`/embeds/github?url=${encodeURIComponent(attrs.href)}`}
      className={isSelected ? "ProseMirror-selectednode" : ""}
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      width="100%"
      height="355px"
      title="GitHub Gist"
    />
  );
}

export default Gist;
