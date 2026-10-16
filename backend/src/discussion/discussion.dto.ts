import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../shared/language';
import {
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  FEED_SCOPES,
  type FeedScope,
  MAX_BODY_LENGTH,
  MAX_QUOTE_LENGTH,
} from './discussion.logic';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Which concept (and language) a discussion belongs to. Same identity XP takes. */
export class TopicDto {
  @IsString()
  @MaxLength(60)
  @Matches(SLUG)
  module: string;

  @IsString()
  @MaxLength(120)
  @Matches(SLUG)
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG)
  discipline?: string;

  @IsIn(SUPPORTED_LANGUAGES)
  lang: string;
}

export class CreateThreadDto extends TopicDto {
  @IsString()
  @Matches(/^[0-9a-f]{8,32}$/)
  anchorKey: string;

  @IsInt()
  @Min(0)
  @Max(2000)
  blockIndex: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUOTE_LENGTH)
  quote: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BODY_LENGTH)
  body: string;
}

export class CommentBodyDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BODY_LENGTH)
  body: string;
}

export class ReplyDto extends CommentBodyDto {
  @IsInt()
  @Min(1)
  parentId: number;
}

/** Filters of the area counts: the same as the feed's, minus the area itself. */
export class FeedAreasDto {
  @IsOptional()
  @IsIn(FEED_SCOPES)
  scope: FeedScope = 'all';

  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  lang?: string;
}

export class FeedDto extends FeedAreasDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(SLUG)
  area?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FEED_MAX_LIMIT)
  limit: number = FEED_DEFAULT_LIMIT;

  /** Opaque; checked by the service, which answers 400 for one it did not issue. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class AcceptDto {
  @IsInt()
  @Min(1)
  replyId: number;
}
