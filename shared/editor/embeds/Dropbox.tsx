import * as React from "react";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function Dropbox({
  attrs,
  matches,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  // "fi" = file
  // "fo" = folder
  // Files need more vertical space to be readable
  const embedHeight = matches[3].split("/")[0] === "fi" ? "550px" : "350px";

  // Wrap inside an iframe to isolate external script and losened CSP
  return (
    <Frame
      src={`/embeds/dropbox?url=${encodeURIComponent(attrs.href)}`}
      className={isSelected ? "ProseMirror-selectednode" : ""}
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      width="100%"
      height={embedHeight}
      title="Dropbox"
    />
  );
}

export default Dropbox;
