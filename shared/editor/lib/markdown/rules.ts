import type { PluginSimple } from "markdown-it";
import markdownit from "markdown-it";
import type { Schema } from "prosemirror-model";
import { isHexColor } from "class-validator";

const textSizePresets = [12, 14, 16, 18, 24, 32];

interface TextStyleSpan {
  color: string | null;
  size: number | null;
}

interface TextStyleEnv {
  textStyleSpanStack?: TextStyleSpan[];
}

type Options = {
  /** Markdown-it options. */
  rules?: markdownit.Options;
  /** Markdown-it plugins. */
  plugins?: PluginSimple[];
  /** The schema for associated editor. */
  schema?: Schema;
};

export default function makeRules({
  rules = {},
  plugins = [],
  schema,
}: Options) {
  const markdownIt = markdownit("default", {
    breaks: false,
    html: false,
    linkify: false,
    ...rules,
  });

  // Disable default markdown-it rules that are not supported by the schema.
  if (!schema?.nodes.ordered_list || !schema?.nodes.bullet_list) {
    markdownIt.disable("list");
  }
  if (!schema?.nodes.blockquote) {
    markdownIt.disable("blockquote");
  }
  if (!schema?.nodes.hr) {
    markdownIt.disable("hr");
  }
  if (!schema?.nodes.heading) {
    markdownIt.disable("heading");
  }

  plugins.forEach((plugin) => markdownIt.use(plugin));
  markdownIt.use(textStyleSpanRule);
  return markdownIt;
}

function textStyleSpanRule(md: markdownit) {
  md.inline.ruler.before("text", "text_style_span", (state, silent) => {
    const source = state.src.slice(state.pos);

    if (source.toLowerCase().startsWith("</span>")) {
      const env = state.env as TextStyleEnv;
      const span = env.textStyleSpanStack?.pop();

      if (!span) {
        return false;
      }

      if (!silent) {
        if (span.size) {
          state.push("text_size_close", "span", -1);
        }
        if (span.color) {
          state.push("text_color_close", "span", -1);
        }
      }

      state.pos += "</span>".length;
      return true;
    }

    const match = source.match(/^<span\s+([^>]*)>/i);

    if (!match?.[1]) {
      return false;
    }

    const color = getAttribute(match[1], "data-text-color");
    const size = parseTextSize(getAttribute(match[1], "data-text-size"));

    if ((!color || !isHexColor(color)) && !size) {
      return false;
    }

    if (!silent) {
      const env = state.env as TextStyleEnv;
      env.textStyleSpanStack = env.textStyleSpanStack ?? [];
      env.textStyleSpanStack.push({ color, size });

      if (color && isHexColor(color)) {
        const token = state.push("text_color_open", "span", 1);
        token.attrSet("data-text-color", color);
      }

      if (size) {
        const token = state.push("text_size_open", "span", 1);
        token.attrSet("data-text-size", String(size));
      }
    }

    state.pos += match[0].length;
    return true;
  });
}

function getAttribute(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));

  return match?.[1] ?? null;
}

function parseTextSize(value: string | null): number | null {
  const size = Number(value?.replace(/px$/, ""));

  if (!textSizePresets.includes(size)) {
    return null;
  }

  return size;
}
