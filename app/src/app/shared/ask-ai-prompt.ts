export type AskAiPromptMode = 'partial' | 'select-all' | 'clipboard';

export interface AskAiPromptResult {
  mode: AskAiPromptMode;
  /** Full prompt text — what to copy to the clipboard when mode is 'clipboard'. */
  promptText: string;
  claudeUrl: string;
  chatGptUrl: string;
}

const CLIPBOARD_THRESHOLD = 1800;

export function buildAskAiPrompt(
  selectedText: string,
  isSelectAll: boolean,
  pageUrl: string,
): AskAiPromptResult {
  const trimmed = selectedText.trim();

  if (isSelectAll) {
    const prompt = `I'm studying the content at ${pageUrl}. Please give me a thorough explanation of the article — break down each key concept covered, explain why it matters, and highlight any nuances or common misconceptions.`;
    return buildResult('select-all', prompt, prompt);
  }

  const fullPrompt = `I'm studying this passage from ${pageUrl} and need help understanding it deeply:\n\n"${trimmed}"\n\nPlease explain what it means, why it matters, and give a concrete example if applicable.`;

  if (fullPrompt.length > CLIPBOARD_THRESHOLD) {
    const shortPrompt = `I'm going to paste a passage I'm studying from ${pageUrl}. Please explain what it means, why it matters, and give a concrete example if applicable.`;
    return buildResult('clipboard', shortPrompt, fullPrompt);
  }

  return buildResult('partial', fullPrompt, fullPrompt);
}

function buildResult(mode: AskAiPromptMode, urlPrompt: string, promptText: string): AskAiPromptResult {
  return {
    mode,
    promptText,
    claudeUrl: `https://claude.ai/new?q=${encodeURIComponent(urlPrompt)}`,
    chatGptUrl: `https://chatgpt.com/?prompt=${encodeURIComponent(urlPrompt)}`,
  };
}
