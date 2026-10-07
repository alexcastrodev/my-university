import { Injectable } from '@nestjs/common';
import { join } from 'path';
import {
  MinuteEpisodeDetail,
  MinuteEpisodeSummary,
  MinuteEpisodesServiceBase,
} from '../shared/minute-episodes.service';

export type JavaMinuteEpisodeSummary = MinuteEpisodeSummary;
export type JavaMinuteEpisodeDetail = MinuteEpisodeDetail;

@Injectable()
export class JavaMinuteService extends MinuteEpisodesServiceBase {
  constructor() {
    super(join(__dirname, '../seed/data/java-minute'));
  }
}
