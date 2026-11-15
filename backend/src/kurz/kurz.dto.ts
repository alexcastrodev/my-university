import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { TopicDto } from '../discussion/discussion.dto';
import { MAX_QUESTION_CHARS, MAX_SELECTION_CHARS } from './kurz.config';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const withAnchor = (o: AskKurzDto) =>
  o.anchorKey !== undefined || o.blockIndex !== undefined;

/**
 * A question. The post is named like a discussion topic is. `selection`, `anchorKey` and `blockIndex` say where
 * in it the student asked from; none is trusted: the selection counts only if the post has that text, and the
 * anchor is only a label to bring the conversation back to its paragraph. Sent with `conversationId`, they are
 * ignored: a conversation keeps the context it started with.
 */
export class AskKurzDto extends TopicDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUESTION_CHARS)
  question: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_SELECTION_CHARS)
  selection?: string;

  @ValidateIf(withAnchor)
  @IsString()
  @Matches(/^[0-9a-f]{8,32}$/)
  anchorKey?: string;

  @ValidateIf(withAnchor)
  @IsInt()
  @Min(0)
  @Max(2000)
  blockIndex?: number;

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

/** The student confirms the privacy notice and that they are 18 or older, in the version they were shown. */
export class AcceptTermsDto {
  @IsString()
  @MaxLength(20)
  version: string;

  @IsBoolean()
  adult: boolean;
}

export class FeedbackDto {
  @IsBoolean()
  helpful: boolean;
}

export class ReportDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}
