import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {JwtAuthGuard} from '../auth/jwt-auth.guard';
import {RoomsService} from './rooms.service';
import {CreateRoomDto} from './dto/create-room.dto';
import {JoinRoomDto} from './dto/join-room.dto';

function uid(req: any) {
    return (req?.user?.userId ?? req?.user?.sub)?.toString();
}

function name(req: any) {
    return req?.user?.displayName;
}

@UseGuards(JwtAuthGuard)
@Controller('rooms') // <-- Sadece 'rooms'. Global prefix main.ts'te veriliyor.
export class RoomsController {
    constructor(private readonly rooms: RoomsService) {
    }

    @Post()
    async create(@Req() req: any, @Body() dto: CreateRoomDto) {
        const {room, participant} = await this.rooms.createRoom(uid(req), name(req) ?? 'Owner', dto);
        return {id: room.id, code: room.code, name: room.name, deckType: room.deckType, participantId: participant.id};
    }

    @Post(':code/join')
    async join(@Req() req: any, @Param('code') code: string, @Body() dto: JoinRoomDto) {
        const {room, participant} = await this.rooms.joinRoom(code, uid(req), dto.displayName ?? name(req) ?? 'Guest');
        return {roomId: room.id, code: room.code, name: room.name, participantId: participant.id};
    }

    @Post(':code/leave')
    async leave(@Req() req: any, @Param('code') code: string, @Body() body: { transferToParticipantId?: string }) {
        return this.rooms.leave(code, uid(req), body?.transferToParticipantId);
    }

    @Post(':code/transfer-owner')
    async transfer(@Req() req: any, @Param('code') code: string, @Body() body: { toParticipantId: string }) {
        return this.rooms.transferOwner(code, uid(req), body.toParticipantId);
    }

    @Get(':code')
    async get(@Param('code') code: string) {
        return this.rooms.getRoomByCode(code);
    }
}
