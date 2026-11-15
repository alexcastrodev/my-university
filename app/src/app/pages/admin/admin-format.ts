import { AdminErrorKind } from '../../admin/admin.model';

export const usd = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);

export const when = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

export function errorText(kind: AdminErrorKind): string {
  switch (kind) {
    case 'forbidden':
      return $localize`:@@admin.error.forbidden:Your account does not hold everything this needs.`;
    case 'conflict':
      return $localize`:@@admin.error.conflict:That conflicts with how things are now (a name already in use, or the last admin).`;
    case 'invalid':
      return $localize`:@@admin.error.invalid:The server did not accept that. Check the values and try again.`;
    default:
      return $localize`:@@admin.error.failed:Something went wrong. Try again.`;
  }
}

export interface Notice {
  kind: 'success' | 'error';
  text: string;
}
