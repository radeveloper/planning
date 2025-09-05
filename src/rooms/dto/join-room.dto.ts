import { IsString, Length } from 'class-validator';

/**
 * DTO for joining an existing room. Clients supply the room code
 * (short identifier) and optionally a display name if not encoded
 * in the JWT. The display name is required here for convenience.
 */
export class JoinRoomDto {
  @IsString()
  @Length(1, 32)
  displayName!: string;
}