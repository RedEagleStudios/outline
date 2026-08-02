import * as React from "react";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function GitLabSnippet({
  attrs,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
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
    <Frame
      ref={frame}
      src={`/embeds/gitlab?url=${encodeURIComponent(attrs.href)}`}
      className={isSelected ? "ProseMirror-selectednode" : ""}
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      width="100%"
      height={`${height}px`}
      title="GitLab Snippet"
    />
  );
}

export default GitLabSnippet;
