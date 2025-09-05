import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Controller exposing REST endpoints for room management. All routes
 * here require a valid JWT. Display names are derived from the JWT
 * payload so the client does not need to resend them on every
 * request. Note that joinRoom does accept a display name to support
 * cases where the JWT does not contain one (e.g. external auth).
 */
@UseGuards(JwtAuthGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  /**
   * Creates a new room and an owner participant. The JWT subject
   * becomes the userId and the display name is read from req.user.
   */
  @Post()
  async createRoom(@Req() req: any, @Body() dto: CreateRoomDto) {
    const { sub: userId, displayName } = req.user;
    const result = await this.roomsService.createRoom(userId, displayName, dto);
    return {
      id: result.room.id,
      code: result.room.code,
      name: result.room.name,
      deckType: result.room.deckType,
      participantId: result.participant.id,
    };
  }

  /**
   * Join an existing room by code. A participant record is created
   * and returned along with the room details. If the room does not
   * exist a 404 is thrown.
   */
  @Post(':code/join')
  async joinRoom(@Param('code') code: string, @Body() dto: JoinRoomDto) {
    const result = await this.roomsService.joinRoom(code, dto.displayName);
    return {
      roomId: result.room.id,
      code: result.room.code,
      name: result.room.name,
      participantId: result.participant.id,
    };
  }

  /**
   * Returns the room and its participants. Useful for debugging or
   * building admin tools. The WebSocket gateway will broadcast
   * similar payloads.
   */
  @Get(':code')
  async getRoom(@Param('code') code: string) {
    const room = await this.roomsService.getRoomByCode(code);
    return room;
  }

    @Post()
    async create(@Req() req, @Body() dto: CreateRoomDto) {
        const userId = req.user?.userId ?? req.user?.sub;
        const displayName = req.user?.displayName ?? 'Guest';
        const { room, participant } = await this.roomsService.createRoom(userId, displayName, dto);
        return { id: room.id, code: room.code, name: room.name, deckType: room.deckType, participantId: participant.id };
    }

    @Post(':code/join')
    async join(@Req() req, @Param('code') code: string, @Body() body: { displayName: string }) {
        const userId = req.user?.userId ?? req.user?.sub;
        const { room, participant } = await this.roomsService.joinRoom(code, body.displayName, userId);
        return { roomId: room.id, code: room.code, name: room.name, participantId: participant.id };
    }

    @Get(':code')
    async get(@Param('code') code: string) {
        const room = await this.roomsService.getRoomByCode(code);
        return room;
    }
}