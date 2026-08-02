import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function InVision({
  attrs,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  return (
    <Frame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      src={attrs.href}
      title="InVision Embed"
    />
  );
}

export default InVision;
