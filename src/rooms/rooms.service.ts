import { BadRequestException, Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { randomBytes } from 'crypto';

type LobbyStatus = 'pending' | 'voting' | 'revealed';

type RoomState = {
    room: { id: string; code: string; name: string; deckType: string };
    participants: Array<{ id: string; displayName: string; isOwner: boolean; hasVoted: boolean }>;
    round: { id: string; status: LobbyStatus; storyId?: string | null } | null;
    votes?: Array<{ participantId: string; value: string }>;
    average?: number;
};

@Injectable()
export class RoomsService {
    private readonly logger = new Logger(RoomsService.name);
    constructor(private readonly prisma: PrismaService) {}

    // ---------- create / join ----------

    async createRoom(userId: string, displayName: string, dto: CreateRoomDto) {
        const code = await this.generateUniqueCode();
        return this.prisma.$transaction(async (tx) => {
            const room = await tx.room.create({
                data: { code, name: dto.name, deckType: dto.deckType, settings: dto.settings ?? {} },
            });
            const participant = await tx.participant.create({
                data: { roomId: room.id, displayName, isOwner: true, userId }, // userId eklendi
            });
            return { room, participant };
        });
    }

    async joinRoom(code: string, displayName: string, userId?: string | null) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        // Aynı kullanıcı daha önce katıldıysa tekrar yaratma
        if (userId) {
            const existing = await this.prisma.participant.findFirst({
                where: { roomId: room.id, userId },
            });
            if (existing) return { room, participant: existing };
        }

        const participant = await this.prisma.participant.create({
            data: { roomId: room.id, displayName, userId: userId ?? null },
        });
        return { room, participant };
    }

    async getRoomByCode(code: string) {
        const room = await this.prisma.room.findUnique({
            where: { code },
            include: {
                participants: true,
                rounds: { orderBy: { startedAt: 'desc' }, take: 1, include: { votes: true } },
            },
        });
        if (!room) throw new NotFoundException('Room not found');
        return room;
    }

    // Public helper
    async buildStateByCode(code: string): Promise<RoomState> {
        const room = await this.getRoomByCodeOrThrow(code);
        return this.buildState(room.id);
    }

    // ---------- helpers ----------

    private async getRoomByCodeOrThrow(code: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');
        return room;
    }

    private async getLatestRound(roomId: string) {
        return this.prisma.round.findFirst({ where: { roomId }, orderBy: { startedAt: 'desc' } });
    }

    private async getParticipantByUserOrThrow(roomId: string, userId: string) {
        const p = await this.prisma.participant.findFirst({ where: { roomId, userId } });
        if (!p) throw new NotFoundException('Participant not found for user');
        return p;
    }

    private async ensureOwnerOrThrow(roomId: string, userId: string) {
        const p = await this.getParticipantByUserOrThrow(roomId, userId);
        if (!p.isOwner) throw new ForbiddenException('Only owner can perform this action');
        return p;
    }

    private async buildState(roomId: string): Promise<RoomState> {
        const [room, participants, round, votes] = await Promise.all([
            this.prisma.room.findUnique({ where: { id: roomId } }),
            this.prisma.participant.findMany({
                where: { roomId, leftAt: null },
                orderBy: { joinedAt: 'asc' },
                select: { id: true, displayName: true, isOwner: true },
            }),
            this.getLatestRound(roomId),
            this.prisma.vote.findMany({
                where: { round: { roomId } },
                select: { participantId: true, value: true, roundId: true },
            }),
        ]);
        if (!room) throw new NotFoundException('Room not found');

        const activeRound = round ?? null;
        const votedSet = new Set(
            votes.filter(v => activeRound && v.roundId === activeRound.id).map(v => v.participantId),
        );

        const base: RoomState = {
            room: { id: room.id, code: room.code, name: room.name, deckType: room.deckType },
            participants: participants.map(p => ({
                id: p.id,
                displayName: p.displayName,
                isOwner: p.isOwner,
                hasVoted: activeRound?.status === 'voting' ? votedSet.has(p.id) : false,
            })),
            round: activeRound
                ? { id: activeRound.id, status: activeRound.status as LobbyStatus, storyId: activeRound.storyId }
                : null,
        };

        if (activeRound?.status === 'revealed') {
            const revVotes = votes.filter(v => v.roundId === activeRound.id);
            const nums = revVotes.map(v => Number(v.value)).filter(n => !Number.isNaN(n));
            const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
            return { ...base, votes: revVotes, average: avg };
        }
        return base;
    }

    // ---------- round / vote ----------

    async startVoting(code: string, storyId: string | null, userId: string) {
        const room = await this.getRoomByCodeOrThrow(code);
        await this.ensureOwnerOrThrow(room.id, userId); // owner check

        const current = await this.getLatestRound(room.id);
        if (current?.status === 'voting') return this.buildState(room.id);

        if (current?.status === 'pending') {
            await this.prisma.round.update({
                where: { id: current.id },
                data: { status: 'voting', startedAt: new Date(), storyId: storyId ?? current.storyId ?? null },
            });
            return this.buildState(room.id);
        }

        await this.prisma.round.create({
            data: { roomId: room.id, storyId: storyId ?? null, status: 'voting', startedAt: new Date() },
        });
        return this.buildState(room.id);
    }

    async castVoteByUser(code: string, userId: string, value: string) {
        const room = await this.getRoomByCodeOrThrow(code);
        const round = await this.getLatestRound(room.id);
        if (!round || round.status !== 'voting') throw new BadRequestException('No active voting round');

        const participant = await this.getParticipantByUserOrThrow(room.id, userId);

        const existing = await this.prisma.vote.findFirst({
            where: { roundId: round.id, participantId: participant.id },
        });

        if (existing) {
            await this.prisma.vote.update({ where: { id: existing.id }, data: { value } });
        } else {
            await this.prisma.vote.create({ data: { roundId: round.id, participantId: participant.id, value } });
        }
        return this.buildState(room.id);
    }

    async reveal(code: string, userId: string) {
        const room = await this.getRoomByCodeOrThrow(code);
        await this.ensureOwnerOrThrow(room.id, userId); // owner check

        const round = await this.getLatestRound(room.id);
        if (!round || round.status !== 'voting') throw new BadRequestException('Nothing to reveal');

        await this.prisma.round.update({
            where: { id: round.id },
            data: { status: 'revealed', endedAt: new Date() },
        });
        return this.buildState(room.id);
    }

    async reset(code: string, userId: string) {
        const room = await this.getRoomByCodeOrThrow(code);
        await this.ensureOwnerOrThrow(room.id, userId); // owner check

        const round = await this.getLatestRound(room.id);
        if (!round || round.status !== 'revealed') return this.buildState(room.id);

        await this.prisma.round.create({
            data: { roomId: room.id, storyId: round.storyId ?? null, status: 'pending', startedAt: new Date() },
        });
        return this.buildState(room.id);
    }

    // ---------- code üretimi ----------

    private async generateUniqueCode(): Promise<string> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = randomBytes(3).toString('hex').toUpperCase();
            const existing = await this.prisma.room.findUnique({ where: { code } });
            if (!existing) return code;
        }
        throw new BadRequestException('Unable to generate unique room code');
    }
}
