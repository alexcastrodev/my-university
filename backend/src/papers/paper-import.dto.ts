import { IsString, MaxLength } from 'class-validator';

/** The body of a DOI lookup or import: any spelling of a DOI, which the service normalizes and validates. */
export class ImportDoiDto {
  @IsString()
  @MaxLength(300)
  doi: string;
}
