import { buildAskAiPrompt } from './ask-ai-prompt';

const PAGE_URL = 'https://ocp-simulator.test/java/java-concepts/generics';

describe('buildAskAiPrompt', () => {
  it('embeds the selected text and page url for a normal partial selection', () => {
    const result = buildAskAiPrompt('Type erasure removes generic type info at runtime.', false, PAGE_URL);

    expect(result.mode).toBe('partial');
    expect(decodeURIComponent(result.claudeUrl)).toContain('Type erasure removes generic type info at runtime.');
    expect(decodeURIComponent(result.claudeUrl)).toContain(PAGE_URL);
    expect(result.claudeUrl.startsWith('https://claude.ai/new?q=')).toBeTrue();
    expect(result.chatGptUrl.startsWith('https://chatgpt.com/?prompt=')).toBeTrue();
  });

  it('omits the selected text and asks for a full breakdown on select-all', () => {
    const result = buildAskAiPrompt('the entire article content '.repeat(50), true, PAGE_URL);

    expect(result.mode).toBe('select-all');
    expect(decodeURIComponent(result.claudeUrl)).not.toContain('entire article content');
    expect(decodeURIComponent(result.claudeUrl)).toContain(PAGE_URL);
  });

  it('falls back to a clipboard prompt for large selections', () => {
    const longText = 'x'.repeat(2000);
    const result = buildAskAiPrompt(longText, false, PAGE_URL);

    expect(result.mode).toBe('clipboard');
    expect(result.promptText).toContain(longText);
    expect(decodeURIComponent(result.claudeUrl)).not.toContain(longText);
  });

  it('trims whitespace around the selected text', () => {
    const result = buildAskAiPrompt('   spaced text   ', false, PAGE_URL);

    expect(result.promptText).toContain('spaced text');
    expect(result.promptText).not.toContain('   spaced');
  });
});
