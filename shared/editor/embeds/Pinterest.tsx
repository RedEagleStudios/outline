import * as React from "react";
import styled from "styled-components";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function Pinterest({
  attrs,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const boardUrl = attrs.href;
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(400);

  React.useEffect(() => {
    const handler = (event: MessageEvent<{ type: string; value: number }>) => {
      const contentWindow =
        frame.current?.contentWindow ||
        frame.current?.contentDocument?.defaultView;
      if (
        event.data.type === "frame-resized" &&
        event.source === contentWindow
      ) {
        setHeight(event.data.value);
      }
    };
    window.addEventListener("message", handler);

    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <PinterestFrame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      ref={frame}
      src={`/embeds/pinterest?url=${encodeURIComponent(boardUrl)}`}
      title="Pinterest Content"
      height={`${height}px`}
      width="100%"
    />
  );
}

const PinterestFrame = styled(Frame)`
  border-radius: 18px;
`;

export default Pinterest;
