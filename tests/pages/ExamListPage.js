export class ExamListPage {
  constructor(page) {
    this.page = page;

    this.heading      = page.getByRole('heading', { name: 'Certification Exams' });
    this.subtitle     = page.getByText('Choose an exam to start practising');
    this.examCards    = page.locator('.exam-card');
  }

  /** The section of one provider, by its heading ("Oracle Java", "Microsoft Azure"). */
  provider(name) {
    return this.page.locator('section.provider').filter({ has: this.page.getByRole('heading', { name }) });
  }

  examCard(title) {
    return this.page.locator('.exam-card').filter({ hasText: title });
  }

  startPracticeLink(title) {
    return this.examCard(title).getByText('Start Practice →');
  }
}
