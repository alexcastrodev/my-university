export class CoursePage {
  constructor(page) {
    this.page = page;

    this.layout        = page.locator('.layout');
    this.mainContent   = page.locator('.main-content');
    this.heroSection   = page.locator('.hero');
    this.courseTitle   = page.locator('.course-title').first();
    this.playButton    = page.getByRole('button', { name: 'Play course overview' });
    this.quizBanner    = page.locator('.quiz-banner');
    this.startExamBtn  = page.getByRole('link', { name: /Start Practice Exam/i });

    this.lessonHeader    = page.locator('.lesson-header');
    this.backBtn         = page.getByRole('button', { name: '← Back to course' });
    this.lessonTitleBar  = page.locator('.lesson-title-bar');
    this.markCompleteBtn = page.getByRole('button', { name: /Mark completed|Completed/i });
  }

  infoCard(label) {
    return this.page.locator('.info-card').filter({ hasText: new RegExp(label, 'i') });
  }

  benefitItem(text) {
    return this.page.locator('.benefit-item').filter({ hasText: text });
  }

  async mainContentOverflowY() {
    await this.mainContent.waitFor();
    return this.page.evaluate(() => {
      const el = document.querySelector('.main-content');
      return el ? getComputedStyle(el).overflowY : null;
    });
  }

  async layoutGridColumns() {
    await this.layout.waitFor();
    return this.page.evaluate(() => {
      const el = document.querySelector('.layout');
      return el ? getComputedStyle(el).gridTemplateColumns : null;
    });
  }
}
