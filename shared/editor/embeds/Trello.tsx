import * as React from "react";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function Trello({
  matches,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const objectId = matches[2];

  if (matches[1] === "c") {
    return (
      <Frame
        style={style}
        isSelected={isSelected}
        isResizing={isResizing}
        viewportGating={viewportGating}
        width="316px"
        height="141px"
        src={`https://trello.com/embed/card?id=${objectId}`}
        title={`Trello Card (${objectId})`}
      />
    );
  }

  return (
    <Frame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      width="248px"
      height="185px"
      src={`https://trello.com/embed/board?id=${objectId}`}
      title={`Trello Board (${objectId})`}
    />
  );
}

export default Trello;
