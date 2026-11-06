import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { SeoService } from '../../services/seo.service';

/** Where the books live in the project's repository: the folder to look at, and the page to create a file in. */
const BOOKS_FOLDER_URL = 'https://github.com/alexcastrodev/my-university/tree/main/public/books';
const BOOKS_NEW_FILE_URL = 'https://github.com/alexcastrodev/my-university/new/main/public/books';

/** Answers to questions people ask about the site. `#books` explains how to get a Library tab on a public profile. */
@Component({
  selector: 'app-faq-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './faq-page.html',
  styleUrl: './faq-page.css',
})
export class FaqPage implements OnInit {
  private seo = inject(SeoService);

  protected readonly foldersUrl = BOOKS_FOLDER_URL;
  protected readonly newFileUrl = BOOKS_NEW_FILE_URL;
  /** The file a person writes. Not translated: it is the format, and the header row is ignored when it is read. */
  protected readonly example = [
    '| Book | Pages | Cover |',
    '| --- | --- | --- |',
    '| [Designing Data-Intensive Applications](https://dataintensive.net/) | 616 | https://covers.openlibrary.org/b/isbn/9781449373320-L.jpg |',
    '| [Clean Code](https://www.oreilly.com/library/view/clean-code-a/9780136083238/) | 464 | |',
  ].join('\n');

  ngOnInit(): void {
    this.seo.set({
      title: 'FAQ',
      description: 'How to show your books on your public profile, and other questions about My University.',
      path: '/faq',
    });
  }
}
