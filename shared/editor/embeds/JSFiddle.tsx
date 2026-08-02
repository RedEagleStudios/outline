import * as React from "react";
import { useTheme } from "styled-components";
import Frame from "../components/Frame";
import type { EmbedProps as Props } from ".";

function JSFiddle({
  attrs,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const normalizedUrl = attrs.href.replace(/(\/embedded)?\/$/, "");
  const theme = useTheme();

  return (
    <Frame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      src={`${normalizedUrl}/embedded/result,js,css,html/${
        theme.isDark ? "dark/" : ""
      }`}
      title="JSFiddle Embed"
      referrerPolicy="strict-origin-when-cross-origin"
      border
    />
  );
}

export default JSFiddle;
