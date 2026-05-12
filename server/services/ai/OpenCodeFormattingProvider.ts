import { spawn } from "node:child_process";
import env from "@server/env";
import { InternalError } from "@server/errors";
import Logger from "@server/logging/Logger";
import type {
  AIFormattingInput,
  AIFormattingProvider,
} from "./AIFormattingProvider";

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/**
 * AI text formatting provider backed by the local OpenCode CLI.
 */
export class OpenCodeFormattingProvider implements AIFormattingProvider {
  /**
   * Rewrites text using OpenCode according to the provided prompt.
   *
   * @param input the selected text and rewrite instruction.
   * @returns the replacement text returned by OpenCode.
   * @throws if OpenCode is not configured or returns no replacement text.
   */
  public async formatText(input: AIFormattingInput): Promise<string> {
    const result = await this.runOpenCode(this.buildPrompt(input));
    const text = this.cleanOutput(result.stdout);

    if (!text) {
      const error = InternalError("OpenCode did not return replacement text");
      Logger.error("OpenCode returned empty formatting output", error, {
        stderr: result.stderr,
      });
      throw error;
    }

    return text;
  }

  private runOpenCode(prompt: string): Promise<ExecFileResult> {
    const args = ["run"];

    if (env.OPENCODE_PRINT_LOGS) {
      args.unshift("--print-logs");
    }

    if (env.OPENCODE_DIR) {
      args.push("--dir", env.OPENCODE_DIR);
    }

    if (env.OPENCODE_ATTACH) {
      args.push("--attach", env.OPENCODE_ATTACH);
    }
    if (env.OPENCODE_MODEL) {
      args.push("--model", env.OPENCODE_MODEL);
    }
    if (env.OPENCODE_AGENT) {
      args.push("--agent", env.OPENCODE_AGENT);
    }

    args.push(prompt);

    Logger.info("utils", "Running OpenCode formatting", {
      command: env.OPENCODE_COMMAND,
      model: env.OPENCODE_MODEL,
      agent: env.OPENCODE_AGENT,
      attach: env.OPENCODE_ATTACH,
      dir: env.OPENCODE_DIR,
      printLogs: env.OPENCODE_PRINT_LOGS,
      timeout: env.AI_FORMATTING_TIMEOUT,
    });

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const startedAt = Date.now();
      const child = spawn(env.OPENCODE_COMMAND, args, {
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            autoupdate: false,
            instructions: [],
            mcp: {
              outline: {
                enabled: false,
              },
            },
            snapshot: false,
            tools: {
              bash: false,
              edit: false,
              glob: false,
              grep: false,
              read: false,
              task: false,
              todowrite: false,
              webfetch: false,
              write: false,
            },
          }),
          ...(env.OPENCODE_CONFIG_DIR
            ? { OPENCODE_CONFIG_DIR: env.OPENCODE_CONFIG_DIR }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        settled = true;
        child.kill("SIGTERM");
        const error = InternalError(
          "OpenCode timed out while rewriting the selected text"
        );
        Logger.error("OpenCode formatting timed out", error, {
          durationMs: Date.now() - startedAt,
          stderr,
        });
        reject(error);
      }, env.AI_FORMATTING_TIMEOUT);

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        Logger.error("OpenCode process error", error, { stderr });
        reject(InternalError(error.message));
      });

      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);

        if (stderr) {
          Logger.warn("OpenCode formatting stderr", { stderr });
        }

        Logger.info("utils", "OpenCode formatting finished", {
          code,
          signal,
          durationMs: Date.now() - startedAt,
        });

        if (code !== 0) {
          reject(InternalError(this.getErrorMessage(code, signal, stderr)));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }

  private getErrorMessage(
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string
  ): string {
    if (signal === "SIGTERM") {
      return "OpenCode timed out while rewriting the selected text";
    }

    const logError = stderr
      .split("\n")
      .reverse()
      .find((line) => line.includes("ERROR") || line.includes("WARN"));

    if (logError) {
      return logError;
    }

    return `OpenCode formatting failed${code === null ? "" : ` with exit code ${code}`}`;
  }

  private buildPrompt(input: AIFormattingInput): string {
    return `Rewrite the selected Markdown according to the instruction.

Rules:
- Return only the replacement Markdown.
- Do not include explanations.
- Do not use markdown fences.
- Preserve meaning unless the instruction asks otherwise.
- Preserve existing formatting unless the instruction asks to change it.
- You may use these Markdown formats when helpful: headings (#), bold (**text**), italic (*text*), strikethrough (~~text~~), inline code (\`code\`), links ([text](url)), blockquotes (>), bullet lists (-), ordered lists (1.), task lists (- [ ]), tables, and code blocks.

Instruction:
${input.prompt}

Selected Markdown:
${input.text}`;
  }

  private cleanOutput(output: string): string {
    const ansiPattern = new RegExp(String.raw`\x1B\[[0-9;]*m`, "g");
    const cleaned = output.replace(ansiPattern, "");
    const lines = cleaned.split(/\r?\n/u);

    while (
      lines[0] !== undefined &&
      (!lines[0].trim() || /^>\s/u.test(lines[0]))
    ) {
      lines.shift();
    }

    return lines
      .join("\n")
      .replace(/^```(?:\w+)?\s*/u, "")
      .replace(/\s*```$/u, "")
      .trim();
  }
}
