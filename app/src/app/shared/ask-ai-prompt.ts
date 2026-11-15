export type AskAiPromptMode = 'partial' | 'select-all' | 'clipboard';

export type AskAiTarget = 'claude' | 'chatgpt' | 'gemini';

export interface AskAiPromptResult {
  mode: AskAiPromptMode;
  /** Full prompt text — what to copy to the clipboard when mode is 'clipboard'. */
  promptText: string;
  urls: Record<AskAiTarget, string>;
}

const CLIPBOARD_THRESHOLD = 1800;

// The prompts go through $localize so the pt-BR bundle asks the AI in Portuguese.
export function buildAskAiPrompt(
  selectedText: string,
  isSelectAll: boolean,
  pageUrl: string,
  question = '',
): AskAiPromptResult {
  const trimmed = selectedText.trim();
  const asked = question.trim();

  if (asked) return buildQuestionPrompt(isSelectAll ? '' : trimmed, pageUrl, asked);

  if (isSelectAll) {
    const prompt = $localize`:@@askAi.prompt.selectAll:I'm studying the content at ${pageUrl}:pageUrl:. Please give me a thorough explanation of the article: break down each key concept covered, explain why it matters, and highlight any nuances or common misconceptions.`;
    return buildResult('select-all', prompt, prompt);
  }

  const fullPrompt = $localize`:@@askAi.prompt.partial:I'm studying this passage from ${pageUrl}:pageUrl: and need help understanding it deeply:\n\n"${trimmed}:passage:"\n\nPlease explain what it means, why it matters, and give a concrete example if applicable.`;

  if (fullPrompt.length > CLIPBOARD_THRESHOLD) {
    const shortPrompt = $localize`:@@askAi.prompt.clipboard:I'm going to paste a passage I'm studying from ${pageUrl}:pageUrl:. Please explain what it means, why it matters, and give a concrete example if applicable.`;
    return buildResult('clipboard', shortPrompt, fullPrompt);
  }

  return buildResult('partial', fullPrompt, fullPrompt);
}

/** The student already wrote a question (in the Kurz's box): it goes along with the passage, in their words. */
function buildQuestionPrompt(passage: string, pageUrl: string, question: string): AskAiPromptResult {
  if (!passage) {
    const prompt = $localize`:@@askAi.prompt.postQuestion:I'm studying the content at ${pageUrl}:pageUrl:. My question: ${question}:question:`;
    return buildResult('select-all', prompt, prompt);
  }
  const fullPrompt = $localize`:@@askAi.prompt.partialQuestion:I'm studying this passage from ${pageUrl}:pageUrl: and I have a question about it:\n\n"${passage}:passage:"\n\nMy question: ${question}:question:`;
  if (fullPrompt.length > CLIPBOARD_THRESHOLD) {
    const shortPrompt = $localize`:@@askAi.prompt.clipboardQuestion:I'm going to paste a passage I'm studying from ${pageUrl}:pageUrl:. My question: ${question}:question:`;
    return buildResult('clipboard', shortPrompt, fullPrompt);
  }
  return buildResult('partial', fullPrompt, fullPrompt);
}

function buildResult(mode: AskAiPromptMode, urlPrompt: string, promptText: string): AskAiPromptResult {
  const q = encodeURIComponent(urlPrompt);
  return {
    mode,
    promptText,
    urls: {
      claude: `https://claude.ai/new?q=${q}`,
      chatgpt: `https://chatgpt.com/?prompt=${q}`,
      gemini: `https://gemini.google.com/app?q=${q}`,
    },
  };
}
