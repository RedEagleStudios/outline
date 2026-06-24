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
 * A mark that applies a preset font size to inline content.
 */
export default class TextSize extends Mark {
  /** Preset text sizes in pixels available in the editor. */
  static presetSizes = [12, 14, 16, 18, 24, 32];

  get name() {
    return "text_size";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        size: {
          default: null,
          validate: "number|null",
        },
      },
      parseDOM: [
        {
          tag: "span[data-text-size]",
          getAttrs: (dom) => {
            const size = TextSize.parseSize(dom.getAttribute("data-text-size"));

            if (!size) {
              return false;
            }

            return { size };
          },
        },
        {
          tag: "span[style]",
          getAttrs: (dom) => {
            const size = TextSize.getSizeFromStyle(dom.getAttribute("style"));

            if (!size) {
              return false;
            }

            return { size };
          },
        },
      ],
      toDOM: (node) => [
        "span",
        {
          "data-text-size": node.attrs.size,
          style: `font-size: ${node.attrs.size}px`,
        },
      ],
    };
  }

  commands({ type }: { type: MarkType }) {
    return (attrs?: { size?: number | null }): Command => {
      if (!attrs?.size) {
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

      if (!TextSize.isPresetSize(attrs.size)) {
        return () => false;
      }

      return toggleMark(type, attrs);
    };
  }

  toMarkdown() {
    return {
      open: (_state: MarkdownSerializerState, mark: ProsemirrorMark) =>
        `<span data-text-size="${mark.attrs.size}" style="font-size: ${mark.attrs.size}px">`,
      close: "</span>",
      mixable: true,
    };
  }

  parseMarkdown() {
    return {
      mark: "text_size",
      getAttrs: (token: MarkdownToken) => {
        const size = TextSize.parseSize(token.attrGet("data-text-size"));

        if (!size) {
          return null;
        }

        return { size };
      },
    };
  }

  private static isPresetSize(size: number): boolean {
    return TextSize.presetSizes.includes(size);
  }

  private static parseSize(value: string | null): number | null {
    const size = Number(value?.replace(/px$/, ""));

    if (!TextSize.isPresetSize(size)) {
      return null;
    }

    return size;
  }

  private static getSizeFromStyle(style: string | null): number | null {
    const size = style?.match(
      /(?:^|;)\s*font-size\s*:\s*(\d+)px\s*(?:;|$)/
    )?.[1];

    return TextSize.parseSize(size ?? null);
  }
}
