import { IsOptional, IsString, IsIn } from 'class-validator';

/**
 * DTO for creating a new room. The deck type dictates which set of
 * cards is shown to voters. In future you could add custom decks.
 */
export class CreateRoomDto {
  @IsString()
  name!: string;

  @IsString()
  @IsIn(['fibonacci', 'tshirt'])
  deckType!: string;

  @IsOptional()
  settings?: Record<string, any>;
}