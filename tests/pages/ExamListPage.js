export class ExamListPage {
  constructor(page) {
    this.page = page;

    this.heading      = page.getByRole('heading', { name: 'Certification Exams' });
    this.subtitle     = page.getByText('Choose an exam to start practising');
    this.categorySections = page.locator('.category-section');
    this.examCards    = page.locator('.exam-card');
  }

  examCard(title) {
    return this.page.locator('.exam-card').filter({ hasText: title });
  }

  categorySection(name) {
    return this.page.locator('.category-section').filter({ hasText: name });
  }

  startPracticeLink(title) {
    return this.examCard(title).getByText('Start Practice →');
  }
}
