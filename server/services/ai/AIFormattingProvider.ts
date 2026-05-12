export interface AIFormattingInput {
  text: string;
  prompt: string;
}

export interface AIFormattingProvider {
  formatText(input: AIFormattingInput): Promise<string>;
}
