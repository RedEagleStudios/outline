import * as React from "react";
import Frame from "../components/Frame";
import Image from "../components/Img";
import type { EmbedProps as Props } from ".";
import { useTheme } from "styled-components";

function PlantUmlDiagrams({
  attrs,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const theme = useTheme();
  const mode = theme.isDark ? "dsvg" : "svg";
  const title = attrs.href.split("/uml/")[1];
  const finalUrl = `https://www.plantuml.com/plantuml/${mode}/${title}`;

  return (
    <Frame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      src={finalUrl}
      icon={
        <Image
          src="/images/plantuml.png"
          alt="PlantUml"
          width={16}
          height={16}
        />
      }
      canonicalUrl={attrs.href}
      border
    />
  );
}

export default PlantUmlDiagrams;
