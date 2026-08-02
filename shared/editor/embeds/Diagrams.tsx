import * as React from "react";
import Frame from "../components/Frame";
import Image from "../components/Img";
import type { EmbedProps as Props } from ".";

function Diagrams({
  attrs,
  embed,
  matches,
  style,
  isSelected,
  isResizing,
  viewportGating,
}: Props) {
  const embedUrl = matches[0];
  const params = new URL(embedUrl).searchParams;
  const titlePrefix = embed.settings?.url ? "Draw.io" : "Diagrams.net";
  const title = params.get("title")
    ? `${titlePrefix} (${params.get("title")})`
    : titlePrefix;

  return (
    <Frame
      style={style}
      isSelected={isSelected}
      isResizing={isResizing}
      viewportGating={viewportGating}
      src={attrs.href}
      icon={
        <Image
          src="/images/diagrams.png"
          alt="Diagrams.net"
          width={16}
          height={16}
        />
      }
      canonicalUrl={attrs.href}
      title={title}
      border
    />
  );
}

export default Diagrams;
