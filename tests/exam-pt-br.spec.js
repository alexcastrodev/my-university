import { test, expect } from '@playwright/test';
import { ExamContentPage } from './pages/ExamContentPage.js';

// The AWS course has Portuguese lessons and questions; the Azure course does not and must keep working.
const ENGLISH_WORDS = /\b(which|company|should|the)\b/i;
const PORTUGUESE_WORDS = /\b(qual|quais|uma|um|que|para|empresa|equipe)\b/i;

test.describe('Certification course content in pt-BR', () => {
  test('shows a translated lesson in Portuguese', async ({ page }) => {
    const content = new ExamContentPage(page, '/pt-BR');
    await content.openLesson('aws-clf-c02', 'clf-1-1');
    await expect(content.lessonHeading).toContainText('Benefícios da Nuvem AWS');
  });

  test('keeps the English lesson in the English bundle', async ({ page }) => {
    const content = new ExamContentPage(page);
    await content.openLesson('aws-clf-c02', 'clf-1-1');
    await expect(content.lessonHeading).toContainText('Benefits of the AWS Cloud');
  });

  test('falls back to English for a lesson with no translation', async ({ page }) => {
    const content = new ExamContentPage(page, '/pt-BR');
    await content.openLesson('azure-ai-200', 'az200-1-1');
    await expect(content.lessonHeading).toContainText('Container Hosting');
  });

  test('serves the practice exam questions and options in Portuguese', async ({ page }) => {
    const content = new ExamContentPage(page, '/pt-BR');
    await content.openQuiz('aws-clf-c02');
    const { question, options } = await content.firstQuestionAndOptions();
    expect(question).toMatch(PORTUGUESE_WORDS);
    expect(question).not.toMatch(ENGLISH_WORDS);
    expect(options.length).toBeGreaterThanOrEqual(4);
  });

  test('serves the practice exam questions in English in the English bundle', async ({ page }) => {
    const content = new ExamContentPage(page);
    await content.openQuiz('aws-clf-c02');
    const { question } = await content.firstQuestionAndOptions();
    expect(question).not.toMatch(PORTUGUESE_WORDS);
  });
});
