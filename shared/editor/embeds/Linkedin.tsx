import * as React from "react";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function Linkedin({
  attrs,
  matches,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const objectId = matches[2];
  const postType = matches[1];
  if (matches[3] === "embed") {
    return (
      <Frame
        style={style}
        isSelected={isSelected}
        isResizing={isResizing}
        viewportGating={viewportGating}
        src={attrs.href}
        title="LinkedIn"
      />
    );
  }
  return (
    <Frame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      src={`https://www.linkedin.com/embed/feed/update/urn:li:${postType}:${objectId}`}
      title="LinkedIn"
    />
  );
}

export default Linkedin;
