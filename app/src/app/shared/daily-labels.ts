import { DailyCardType } from '../models/daily.model';

/** Eyebrow for each card type, shared by the Today preview list and the card runner. */
const CARD_TYPE_LABELS: Record<DailyCardType, string> = {
  recall: $localize`:@@daily.type.recall:RECALL`,
  read: $localize`:@@daily.type.read:READ`,
  notice: $localize`:@@daily.type.notice:NOTICE`,
  write: $localize`:@@daily.type.write:WRITE`,
};

export function dailyCardTypeLabel(type: DailyCardType): string {
  return CARD_TYPE_LABELS[type];
}
