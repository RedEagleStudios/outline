import { CloseIcon, DoneIcon, ReturnIcon } from "outline-icons";
import { diffWordsWithSpace, type Change } from "diff";
import {
  DOMSerializer,
  Fragment,
  type Node as PMNode,
} from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import { transparentize } from "polished";
import styled from "styled-components";
import Flex from "~/components/Flex";
import { s } from "@shared/styles";
import { useTranslation } from "react-i18next";
import { client } from "~/utils/ApiClient";
import Spinner from "@shared/components/Spinner";
import Input from "./Input";
import { useEditor } from "./EditorContext";
import ToolbarButton from "./ToolbarButton";
import Tooltip from "./Tooltip";

type Props = {
  view: EditorView;
  selectedText: string;
  selectedMarkdown: string;
  isInTableCell: boolean;
  from: number;
  to: number;
  onApply: () => void;
  onCancel: () => void;
  onClickBack: () => void;
  onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
};

interface AIFormatResponse {
  data: {
    text: string;
  };
}

interface DiffRange {
  from: number;
  to: number;
  type: "added" | "removed";
}

function getDiffRanges(changes: Change[], mode: "before" | "after") {
  let position = 0;
  const ranges: DiffRange[] = [];

  changes.forEach((change) => {
    if (change.added && mode === "before") {
      return;
    }
    if (change.removed && mode === "after") {
      return;
    }

    const from = position;
    const to = position + change.value.length;

    if (change.added && mode === "after") {
      ranges.push({ from, to, type: "added" });
    }
    if (change.removed && mode === "before") {
      ranges.push({ from, to, type: "removed" });
    }

    position = to;
  });

  return ranges;
}

function applyDiffRanges(root: HTMLElement, ranges: DiffRange[]) {
  if (!ranges.length) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  const textNodes: Text[] = [];
  let node = walker.nextNode();

  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    let localOffset = 0;
    let currentNode = textNode;
    const length = textNode.nodeValue?.length ?? 0;

    ranges.forEach((range) => {
      const from = Math.max(range.from - offset, localOffset);
      const to = Math.min(range.to - offset, length);

      if (from >= to) {
        return;
      }

      if (from > localOffset) {
        currentNode = currentNode.splitText(from - localOffset);
        localOffset = from;
      }

      const after = currentNode.splitText(to - localOffset);
      const mark = document.createElement("span");
      mark.className = `ai-preview-${range.type}`;
      currentNode.parentNode?.insertBefore(mark, currentNode);
      mark.appendChild(currentNode);
      currentNode = after;
      localOffset = to;
    });

    offset += length;
  });
}

function MarkdownPreview(props: { markdown: string; ranges: DiffRange[] }) {
  const editor = useEditor();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const element = ref.current;
    const doc = editor.parser.parse(props.markdown);

    if (!element || !doc) {
      return;
    }

    element.replaceChildren();
    const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(
      doc.content,
      { document }
    );
    element.appendChild(fragment);
    applyDiffRanges(element, props.ranges);
  }, [editor.parser, editor.schema, props.markdown, props.ranges]);

  return <RenderedPreview ref={ref} />;
}

function flattenTableContent(node: PMNode): PMNode[] {
  const nodes: PMNode[] = [];

  node.forEach((child) => {
    if (child.type.name === "table" || child.type.name === "tr") {
      nodes.push(...flattenTableContent(child));
      return;
    }

    if (child.type.name === "td" || child.type.name === "th") {
      child.forEach((cellChild) => nodes.push(cellChild));
      return;
    }

    nodes.push(child);
  });

  return nodes;
}

/**
 * Renders the selection toolbar UI for AI-powered text formatting.
 *
 * @param props the selected range, selected text, and toolbar callbacks.
 * @returns the AI formatting prompt UI.
 */
export function AITextFormatter(props: Props) {
  const { t } = useTranslation();
  const editor = useEditor();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [isLoading, setIsLoading] = React.useState(false);
  const [suggestion, setSuggestion] = React.useState<string | undefined>();
  const changes = React.useMemo(
    () =>
      suggestion ? diffWordsWithSpace(props.selectedMarkdown, suggestion) : [],
    [props.selectedMarkdown, suggestion]
  );
  const beforeRanges = React.useMemo(
    () => getDiffRanges(changes, "before"),
    [changes]
  );
  const afterRanges = React.useMemo(
    () => getDiffRanges(changes, "after"),
    [changes]
  );

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setPrompt(event.target.value);
      setError(undefined);
      setSuggestion(undefined);
    },
    []
  );

  const handleSubmit = React.useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(undefined);
    setSuggestion(undefined);

    try {
      const response = await client.post<AIFormatResponse>("/ai.format", {
        text: props.selectedMarkdown,
        prompt: props.isInTableCell
          ? `${trimmedPrompt}\n\nThe selected content is inside an existing table cell. Do not return Markdown table syntax or create a new table; return only content that belongs inside the cell.`
          : trimmedPrompt,
      });

      setSuggestion(response.data.text);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message || t("AI formatting failed")
          : t("AI formatting failed")
      );
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, prompt, props.isInTableCell, props.selectedMarkdown, t]);

  const handleAccept = React.useCallback(() => {
    if (!suggestion) {
      return;
    }

    try {
      const currentText = props.view.state.doc.textBetween(
        props.from,
        props.to,
        "\n\n"
      );
      if (currentText !== props.selectedText) {
        setError(t("Selection changed, try again."));
        return;
      }

      const doc = editor.parser.parse(suggestion);
      if (!doc) {
        setError(t("AI returned invalid formatting."));
        return;
      }

      const { doc: currentDoc } = props.view.state;
      const $from = currentDoc.resolve(props.from);
      const $to = currentDoc.resolve(props.to);
      const isInlineSelection =
        $from.sameParent($to) && $from.parent.inlineContent;
      const firstChild = doc.firstChild;
      const replacement =
        isInlineSelection && firstChild
          ? firstChild.content
          : props.isInTableCell
            ? Fragment.fromArray(flattenTableContent(doc))
            : doc.content;

      props.view.dispatch(
        props.view.state.tr
          .replaceWith(props.from, props.to, replacement)
          .scrollIntoView()
      );
      props.view.focus();
      props.onApply();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message || t("AI formatting failed")
          : t("AI formatting failed")
      );
    }
  }, [editor.parser, props, suggestion, t]);

  const handleDecline = React.useCallback(() => {
    setSuggestion(undefined);
    setError(undefined);
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleSubmit();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        props.onCancel();
      }
    },
    [handleSubmit, props]
  );

  return (
    <Wrapper>
      <InputWrapper>
        <DragHandle
          aria-label={t("Drag AI formatter")}
          onPointerDown={props.onDragStart}
          title={t("Drag")}
          type="button"
        >
          <DragDot />
          <DragDot />
          <DragDot />
          <DragDot />
          <DragDot />
          <DragDot />
        </DragHandle>
        <Input
          ref={inputRef}
          value={prompt}
          placeholder={t("Tell AI how to change this text")}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          readOnly={isLoading}
        />
        <Tooltip content={isLoading ? t("AI is rewriting…") : t("Preview")}>
          <ToolbarButton
            onClick={handleSubmit}
            disabled={!prompt.trim() || isLoading || !!suggestion}
          >
            {isLoading ? <Spinner /> : <DoneIcon />}
          </ToolbarButton>
        </Tooltip>
        <Tooltip content={t("Cancel")}>
          <ToolbarButton onClick={props.onCancel} disabled={isLoading}>
            <CloseIcon />
          </ToolbarButton>
        </Tooltip>
        <Tooltip content={t("Formatting controls")}>
          <ToolbarButton onClick={props.onClickBack} disabled={isLoading}>
            <ReturnIcon />
          </ToolbarButton>
        </Tooltip>
      </InputWrapper>
      {isLoading && (
        <LoadingText>{t("AI is rewriting the selected text…")}</LoadingText>
      )}
      {suggestion && (
        <Preview>
          <PreviewColumn>
            <PreviewLabel>{t("Before")}</PreviewLabel>
            <PreviewText>
              <MarkdownPreview
                markdown={props.selectedMarkdown}
                ranges={beforeRanges}
              />
            </PreviewText>
          </PreviewColumn>
          <PreviewColumn>
            <PreviewLabel>{t("After")}</PreviewLabel>
            <PreviewText>
              <MarkdownPreview markdown={suggestion} ranges={afterRanges} />
            </PreviewText>
          </PreviewColumn>
          <PreviewActions>
            <PreviewButton type="button" onClick={handleAccept}>
              {t("Accept")}
            </PreviewButton>
            <PreviewButton type="button" onClick={handleDecline}>
              {t("Decline")}
            </PreviewButton>
          </PreviewActions>
        </Preview>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Wrapper>
  );
}

const Wrapper = styled.div`
  background: ${s("menuBackground")};
  border-radius: 4px;
  box-shadow: ${s("menuShadow")};
  line-height: normal;
  min-width: 640px;
  pointer-events: all;
  white-space: normal;
`;

const InputWrapper = styled(Flex)`
  gap: 6px;
  padding: 6px;
  align-items: center;
`;

const DragHandle = styled.button`
  align-content: center;
  background: transparent;
  border: 0;
  cursor: grab;
  display: grid;
  flex: 0 0 auto;
  gap: 2px;
  grid-template-columns: repeat(2, 3px);
  height: 24px;
  justify-content: center;
  padding: 0 4px;

  &:active {
    cursor: grabbing;
  }
`;

const DragDot = styled.span`
  background: ${s("textSecondary")};
  border-radius: 50%;
  display: block;
  height: 3px;
  opacity: 0.8;
  width: 3px;
`;

const ErrorText = styled.div`
  color: ${s("danger")};
  font-size: 12px;
  padding: 0 8px 8px;
`;

const LoadingText = styled.div`
  color: ${s("textSecondary")};
  font-size: 12px;
  padding: 0 8px 8px;
`;

const Preview = styled.div`
  background: ${s("menuBackground")};
  border-top: 1px solid ${s("divider")};
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  max-height: min(420px, 60vh);
  overflow: auto;
  padding: 8px;
`;

const PreviewColumn = styled.div`
  display: grid;
  gap: 4px;
`;

const PreviewLabel = styled.div`
  color: ${s("textSecondary")};
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  text-transform: uppercase;
`;

const PreviewText = styled.div`
  background: ${s("inputBorder")};
  border-radius: 4px;
  color: ${s("text")};
  font-size: 13px;
  line-height: 1.45;
  max-height: 260px;
  overflow: auto;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-word;
`;

const RenderedPreview = styled.div`
  line-height: 1.45;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p,
  ul,
  ol,
  blockquote,
  pre,
  table {
    margin: 0 0 0.5em;
  }

  .ai-preview-added {
    background: ${(props) => transparentize(0.78, props.theme.success)};
    border-radius: 2px;
  }

  .ai-preview-removed {
    background: ${(props) => transparentize(0.78, props.theme.danger)};
    border-radius: 2px;
    text-decoration: line-through;
  }
`;

const PreviewActions = styled.div`
  display: flex;
  gap: 8px;
  grid-column: 1 / -1;
  justify-content: flex-end;
`;

const PreviewButton = styled.button`
  background: ${s("backgroundSecondary")};
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  color: ${s("text")};
  cursor: var(--pointer);
  font-size: 13px;
  padding: 4px 8px;

  &:hover {
    background: ${s("buttonNeutralBackground")};
  }
`;
