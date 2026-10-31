import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaperFilterDto } from './paper-query.dto';
import { LIBRARY_STATUSES } from './paper-library.entity';
import type { LibraryStatus } from './paper-library.entity';

export const LIBRARY_SORTS = ['added', 'title', 'completed', 'rating'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class AddToLibraryDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  paperId: number;

  @IsOptional()
  @IsIn(LIBRARY_STATUSES)
  status?: LibraryStatus;
}

/**
 * A change to one library entry. A missing field is left alone; `null` clears `rating` and
 * `completedAt`; `tags` replaces the whole list.
 */
export class UpdateLibraryEntryDto {
  @IsOptional()
  @IsIn(LIBRARY_STATUSES)
  status?: LibraryStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  /** The day it was finished, `YYYY-MM-DD`. Only meaningful for a paper whose status is `read`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'completedAt must be YYYY-MM-DD' })
  completedAt?: string | null;
}

/** Query string of the library list: the catalog filters, plus the reader's own status and tag. */
export class LibraryQueryDto extends PaperFilterDto {
  @IsOptional()
  @Transform(trim)
  @IsIn(LIBRARY_STATUSES)
  status?: LibraryStatus;

  /** One whole tag, as the reader wrote it; case does not matter. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_TAG_LENGTH)
  tag?: string;

  @IsOptional()
  @Transform(trim)
  @IsIn(LIBRARY_SORTS)
  sort?: LibrarySort;
}
