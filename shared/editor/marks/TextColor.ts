import { isHexColor } from "class-validator";
import { toggleMark } from "prosemirror-commands";
import type {
  Mark as ProsemirrorMark,
  MarkSpec,
  MarkType,
} from "prosemirror-model";
import type { Command } from "prosemirror-state";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import Mark from "./Mark";

interface MarkdownToken {
  attrGet(name: string): string | null;
}

/**
 * A mark that applies a sanitized text color to inline content.
 */
export default class TextColor extends Mark {
  get name() {
    return "text_color";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        color: {
          default: null,
          validate: "string|null",
        },
      },
      parseDOM: [
        {
          tag: "span[data-text-color]",
          getAttrs: (dom) => {
            const color = dom.getAttribute("data-text-color");

            if (!color || !isHexColor(color)) {
              return false;
            }

            return { color };
          },
        },
        {
          tag: "span[style]",
          getAttrs: (dom) => {
            const color = TextColor.getHexColorFromStyle(
              dom.getAttribute("style")
            );

            if (!color) {
              return false;
            }

            return { color };
          },
        },
      ],
      toDOM: (node) => [
        "span",
        {
          "data-text-color": node.attrs.color,
          style: `color: ${node.attrs.color}`,
        },
      ],
    };
  }

  commands({ type }: { type: MarkType }) {
    return (attrs?: { color?: string | null }): Command => {
      if (!attrs?.color) {
        return (state, dispatch) => {
          if (dispatch) {
            const { empty, from, to, $from } = state.selection;
            const tr = state.tr.removeMark(from, to, type);

            if (empty) {
              const marks = state.storedMarks ?? $from.marks();
              tr.setStoredMarks(type.removeFromSet(marks));
            }

            dispatch(tr);
          }

          return true;
        };
      }

      if (!isHexColor(attrs.color)) {
        return () => false;
      }

      return toggleMark(type, attrs);
    };
  }

  toMarkdown() {
    return {
      open: (_state: MarkdownSerializerState, mark: ProsemirrorMark) =>
        `<span data-text-color="${mark.attrs.color}" style="color: ${mark.attrs.color}">`,
      close: "</span>",
      mixable: true,
    };
  }

  parseMarkdown() {
    return {
      mark: "text_color",
      getAttrs: (token: MarkdownToken) => {
        const color = token.attrGet("data-text-color");

        if (!color || !isHexColor(color)) {
          return null;
        }

        return { color };
      },
    };
  }

  private static getHexColorFromStyle(style: string | null): string | null {
    const color = style?.match(
      /(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8})\s*(?:;|$)/
    )?.[1];

    if (!color || !isHexColor(color)) {
      return null;
    }

    return color;
  }
}
