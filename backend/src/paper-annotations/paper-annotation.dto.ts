import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ANNOTATION_KINDS } from './paper-annotation.entity';
import type { AnnotationKind } from './paper-annotation.entity';
import { VISIBILITIES } from './paper-annotation-share.entity';
import type { Visibility } from './paper-annotation-share.entity';

export const MAX_BODY = 5000;
export const MAX_QUOTE = 2000;
export const MAX_CONTEXT = 200;
export const MAX_RECTS = 100;
export const MAX_PAGE = 100000;
/** No NUL: PostgreSQL does not store it in text. Everything else is kept as typed and escaped on display. */
const NO_NUL = /^[^\u0000]*$/;

export class RectDto {
  @IsNumber() @Min(0) @Max(1) x: number;
  @IsNumber() @Min(0) @Max(1) y: number;
  @IsNumber() @Min(0) @Max(1) w: number;
  @IsNumber() @Min(0) @Max(1) h: number;
}

export class CreateAnnotationDto {
  @IsIn(ANNOTATION_KINDS)
  kind: AnnotationKind;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY)
  @Matches(NO_NUL)
  body?: string;

  /** The PDF version the reader was looking at; the server refuses it when that is no longer the current one. */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUOTE)
  @Matches(NO_NUL)
  quote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTEXT)
  @Matches(NO_NUL)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTEXT)
  @Matches(NO_NUL)
  suffix?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RECTS)
  @ValidateNested({ each: true })
  @Type(() => RectDto)
  rects?: RectDto[];
}

/**
 * A change to one annotation. A missing field is left alone. `kind: 'note'` is only for a stale anchored
 * annotation: it keeps what it said (and its quote) as a free-form note, which is how a reader settles one
 * the PDF outgrew.
 */
export class UpdateAnnotationDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY)
  @Matches(NO_NUL)
  body?: string;

  @IsOptional()
  @IsIn(['note'])
  kind?: 'note';
}

export const MAX_RECIPIENTS = 20;
/** How many reading groups one annotation can be shared into at once. */
export const MAX_GROUPS = 5;

/**
 * Who a shared annotation is for. `users` names the readers by their public profile (the vanity slug, the
 * profile id, or the link `/u/...` that holds either): the same name they already give out, and only readers
 * whose profile is public can be named.
 */
export class ShareAnnotationDto {
  @IsIn(VISIBILITIES)
  visibility: Visibility;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RECIPIENTS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @Matches(NO_NUL, { each: true })
  recipients?: string[];

  /** For `group`: the reading groups (ids) to share into, up to `MAX_GROUPS`, all of which the reader is in. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GROUPS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  groups?: string[];
}
