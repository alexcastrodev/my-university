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
} from 'class-validator';
import { PAPER_TYPES } from './paper.entity';
import type { PaperType } from './paper.entity';

export const PAPER_SORTS = ['recent', 'title'] as const;
export type PaperSort = (typeof PAPER_SORTS)[number];

export const PAPER_PAGE_DEFAULT_LIMIT = 20;
export const PAPER_PAGE_MAX_LIMIT = 50;

/** A blank value (`?author=`) means "not filtered", the same as leaving the parameter out. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** The filters and paging every paper list shares (catalog and library). Optional, combined with AND. */
export class PaperFilterDto {
  /** Free text over title, abstract, DOI, author names and keywords. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  author?: string;

  /** Any spelling of a DOI, or a fragment of one. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  doi?: string;

  /** A whole keyword, as the paper lists it; case does not matter. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  area?: string;

  @IsOptional()
  @Transform(trim)
  @IsIn(PAPER_TYPES)
  type?: PaperType;

  /** Publication year, four digits. */
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{4}$/, { message: 'year must be four digits' })
  year?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAPER_PAGE_MAX_LIMIT)
  limit?: number;
}

/** Query string of the public catalog. */
export class PaperListQueryDto extends PaperFilterDto {
  @IsOptional()
  @Transform(trim)
  @IsIn(PAPER_SORTS)
  sort?: PaperSort;
}
