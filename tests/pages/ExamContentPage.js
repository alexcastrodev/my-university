import { BASE_URL } from '../BaseTest.js';

/** A lesson and the practice exam of a certification course, in either language bundle ("" is English, "/pt-BR" is Portuguese). */
export class ExamContentPage {
  constructor(page, localePrefix = '') {
    this.page = page;
    this.localePrefix = localePrefix;

    this.courseTitle   = page.locator('.course-title').first();
    this.moduleTitles  = page.locator('.module-title');
    this.lessonHeading = page.locator('.lesson-body h1').first();
    this.questionText  = page.locator('.question-text');
    this.optionText    = page.locator('.option-text');
  }

  async openCourse(examId) {
    await this.page.goto(`${BASE_URL}${this.localePrefix}/exam/${examId}`);
    await this.moduleTitles.first().waitFor();
  }

  async openLesson(examId, lessonId) {
    await this.page.goto(`${BASE_URL}${this.localePrefix}/exam/${examId}/lesson/${lessonId}`);
    await this.lessonHeading.waitFor();
  }

  async openQuiz(examId) {
    await this.page.goto(`${BASE_URL}${this.localePrefix}/exam/${examId}/quiz`);
    await this.questionText.waitFor();
  }

  async firstQuestionAndOptions() {
    return {
      question: await this.questionText.innerText(),
      options: await this.optionText.allInnerTexts(),
    };
  }
}
