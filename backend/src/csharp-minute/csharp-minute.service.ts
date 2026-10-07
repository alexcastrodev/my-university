import { Injectable } from '@nestjs/common';
import { join } from 'path';
import {
  MinuteEpisodeDetail,
  MinuteEpisodeSummary,
  MinuteEpisodesServiceBase,
} from '../shared/minute-episodes.service';

export type CSharpMinuteEpisodeSummary = MinuteEpisodeSummary;
export type CSharpMinuteEpisodeDetail = MinuteEpisodeDetail;

@Injectable()
export class CSharpMinuteService extends MinuteEpisodesServiceBase {
  constructor() {
    super(join(__dirname, '../seed/data/csharp-minute'));
  }
}
