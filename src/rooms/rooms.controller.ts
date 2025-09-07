import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';

function uidFromReq(req: any): string {
    return (req?.user?.userId ?? req?.user?.sub)?.toString();
}
function nameFromReq(req: any): string | undefined {
    return req?.user?.displayName;
}

@UseGuards(JwtAuthGuard)
@Controller('rooms') // <-- Sadece 'rooms'. Global prefix main.ts'te veriliyor.
export class RoomsController {
    constructor(private readonly rooms: RoomsService) {}

    @Post()
    async create(@Req() req: any, @Body() dto: CreateRoomDto) {
        const userId = uidFromReq(req);
        const displayName = nameFromReq(req) ?? 'Owner';
        const { room, participant } = await this.rooms.createRoom(
            userId,
            displayName,
            dto,
        );
        return {
            id: room.id,
            code: room.code,
            name: room.name,
            deckType: room.deckType,
            participantId: participant.id,
        };
    }

    @Post(':code/join')
    async join(
        @Req() req: any,
        @Param('code') code: string,
        @Body() dto: JoinRoomDto,
    ) {
        const userId = uidFromReq(req);
        const displayName = dto.displayName ?? nameFromReq(req) ?? 'Guest';
        const { room, participant } = await this.rooms.joinRoom(
            code,
            userId,
            displayName,
        );
        return {
            roomId: room.id,
            code: room.code,
            name: room.name,
            participantId: participant.id,
        };
    }

    @Get(':code')
    async get(@Param('code') code: string) {
        return this.rooms.getRoomByCode(code);
    }
}
