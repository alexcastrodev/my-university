import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PAPER_TYPES } from './paper.entity';
import type { PaperType } from './paper.entity';

export class PaperAuthorDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(200)
  name: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, {
    message: 'orcid must look like 0000-0002-1825-0097',
  })
  orcid?: string;
}

/** A paper as a source describes it. Only the title is required; anything else may be missing. */
export class PaperInputDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'title must not be blank' })
  @MaxLength(1000)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  abstract?: string;

  /** Any common spelling (`10.1/x`, `doi:10.1/x`, `https://doi.org/10.1/x`); stored normalized. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  doi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  venue?: string;

  @IsOptional()
  @Matches(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, {
    message: 'publicationDate must be YYYY, YYYY-MM or YYYY-MM-DD',
  })
  publicationDate?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  researchArea?: string;

  @IsOptional()
  @IsIn(PAPER_TYPES)
  type?: PaperType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PaperAuthorDto)
  authors?: PaperAuthorDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keywords?: string[];
}
