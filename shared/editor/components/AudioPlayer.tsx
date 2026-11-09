import { DownloadIcon } from "outline-icons";
import type { MouseEventHandler, ReactNode } from "react";
import styled from "styled-components";
import { s } from "../../styles";
import { sanitizeUrl } from "../../utils/urls";
import Flex from "../../components/Flex";
import type { ComponentProps } from "../types";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import { Preview, Subtitle, Title } from "./Widget";

type Props = ComponentProps & {
  /** Icon to display on the left side of the header */
  icon: ReactNode;
  /** Context, displayed to right of title */
  context?: ReactNode;
  /** Callback fired when the header is pressed */
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  /** Callback fired when the header is double clicked */
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
};

/**
 * Renders an audio attachment with a native inline player so files can be
 * listened to without downloading them first.
 *
 * @param props the component props.
 * @returns the audio attachment element.
 */
export default function AudioPlayer(props: Props) {
  const { node, isSelected, isEditable, icon, context } = props;
  const { href, title } = node.attrs;

  return (
    <Wrapper
      contentEditable={false}
      className={
        isSelected ? "audio-player ProseMirror-selectednode" : "audio-player"
      }
    >
      <Header
        gap={6}
        align="center"
        onMouseDown={props.onMouseDown}
        onDoubleClick={props.onDoubleClick}
      >
        {icon}
        <Preview>
          <Title>{title}</Title>
          <Subtitle>{context}</Subtitle>
          {href && !isEditable && (
            <DownloadLink
              href={sanitizeUrl(href)}
              target="_blank"
              rel="noreferrer nofollow"
              download={title}
              aria-label={title}
            >
              <DownloadIcon size={20} />
            </DownloadLink>
          )}
        </Preview>
      </Header>
      {href && (
        <StyledAudio
          controls
          preload="metadata"
          src={sanitizeUrl(href)}
          title={title}
        />
      )}
    </Wrapper>
  );
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 840px;
  background: ${s("background")};
  box-shadow: 0 0 0 1px ${s("divider")};
  border-radius: ${EditorStyleHelper.blockRadius};
  padding: ${EditorStyleHelper.blockRadius};
  user-select: none;
`;

const Header = styled(Flex)`
  min-width: 0;
  cursor: var(--pointer);
  white-space: nowrap;
  overflow: hidden;
`;

const DownloadLink = styled.a`
  display: flex;
  margin-left: auto;
  color: ${s("textTertiary")};

  &:hover {
    color: ${s("text")};
  }
`;

const StyledAudio = styled.audio`
  display: block;
  width: 100%;
  height: 40px;
`;
