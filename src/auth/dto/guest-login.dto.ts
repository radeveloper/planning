import { IsString, Length } from 'class-validator';

/**
 * Data Transfer Object for guest authentication. Users provide a
 * display name which is used for creating a signed JWT. The
 * validators enforce a non-empty string between 1 and 32
 * characters. If you wish to allow longer nicknames, adjust the
 * Length decorator accordingly.
 */
export class GuestLoginDto {
  @IsString()
  @Length(1, 32)
  displayName!: string;
}