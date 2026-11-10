import { IsString, MaxLength } from 'class-validator';
import { COLLECTION_NAME_MAX } from './paper-collections.service';

/** Creating or renaming a collection. The service trims the name and refuses a blank one. */
export class CollectionNameDto {
  @IsString()
  @MaxLength(COLLECTION_NAME_MAX)
  name: string;
}
