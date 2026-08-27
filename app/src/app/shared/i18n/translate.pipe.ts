import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from './translate.service';
import { TranslationKeyLike } from './translations';

@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private translate = inject(TranslateService);

  transform(key: TranslationKeyLike, params?: Record<string, string | number>): string {
    return this.translate.t(key, params);
  }
}
