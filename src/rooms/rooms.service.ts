// src/rooms/rooms.service.ts
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client'; // ✅ TransactionClient tipi için

type Json = Record<string, any>;

@Injectable()
export class RoomsService {
    constructor(private readonly prisma: PrismaService) {}

    /** ----------------------------------------
     *  Public API (REST & WS)
     *  ---------------------------------------- */

    /** Oda + owner participant oluşturur, owner'a userId yazar. */
    async createRoom(userId: string, displayName: string, dto: CreateRoomDto) {
        const code = await this.generateUniqueCode();

        return this.prisma.$transaction(async (tx) => {
            const room = await tx.room.create({
                data: {
                    code,
                    name: dto.name,
                    deckType: dto.deckType,
                    settings: dto.settings ?? {},
                },
            });

            const participant = await tx.participant.create({
                data: {
                    roomId: room.id,
                    displayName,
                    isOwner: true,
                    userId, // ✅ kritik
                },
            });

            return { room, participant };
        });
    }

    /**
     * Var olan odaya userId bağlı participant ekler (veya varsa günceller).
     * Aynı kullanıcı aynı odaya ikinci kez farklı participant olarak giremez.
     */
    async joinRoom(code: string, userId: string, displayName: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const existing = await this.prisma.participant.findFirst({
            where: { roomId: room.id, userId },
        });

        const participant = existing
            ? await this.prisma.participant.update({
                where: { id: existing.id },
                data: { displayName },
            })
            : await this.prisma.participant.create({
                data: {
                    roomId: room.id,
                    displayName,
                    userId, // ✅ kritik
                    isOwner: false,
                },
            });

        return { room, participant };
    }

    /** Kodla odayı ve son round’u (votes dâhil) getirir. */
    async getRoomByCode(code: string) {
        const room = await this.prisma.room.findUnique({
            where: { code },
            include: {
                participants: true,
                rounds: {
                    orderBy: { startedAt: 'desc' },
                    take: 1,
                    include: { votes: true },
                },
            },
        });
        if (!room) throw new NotFoundException('Room not found');
        return room;
    }

    /** UI/WS için normalize edilmiş state döndürür. */
    async buildStateByCode(code: string) {
        const room = await this.getRoomByCode(code);
        return this.normalizeState(room);
    }

    /** Owner başlatır. Yeni bir "voting" round oluşturur. */
    async startVoting(code: string, storyId: string | null, userId: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const actor = await this.getParticipantByUserOrThrow(room.id, userId);
        if (!actor.isOwner) throw new ForbiddenException('Only owner can start voting');

        return this.prisma.$transaction(async (tx) => {
            // Eski aktif round’u kapat (varsa)
            const current = await tx.round.findFirst({
                where: { roomId: room.id, status: { in: ['pending', 'voting'] } },
                orderBy: { startedAt: 'desc' },
            });
            if (current) {
                await tx.round.update({
                    where: { id: current.id },
                    data: { status: 'archived', endedAt: new Date() },
                });
            }

            await tx.round.create({
                data: {
                    roomId: room.id,
                    storyId,
                    status: 'voting',
                    startedAt: new Date(),
                },
            });

            // ✅ tx içinden state
            return this.buildStateByRoomTx(tx, room.id);
        });
    }

    /** User oy atar. */
    async castVoteByUser(code: string, userId: string, value: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const participant = await this.getParticipantByUserOrThrow(room.id, userId);

        // Aktif voting round’u bul
        const round = await this.prisma.round.findFirst({
            where: { roomId: room.id, status: 'voting' },
            orderBy: { startedAt: 'desc' },
        });
        if (!round) throw new BadRequestException('No active voting round');

        // ❗ Şemada composite unique yoksa upsert'ta where kullanamayız.
        // Bu yüzden önce ara, varsa update; yoksa create.
        const existing = await this.prisma.vote.findFirst({
            where: { participantId: participant.id, roundId: round.id },
            select: { id: true },
        });

        if (existing) {
            await this.prisma.vote.update({
                where: { id: existing.id },
                data: { value },
            });
        } else {
            await this.prisma.vote.create({
                data: {
                    participantId: participant.id,
                    roundId: round.id,
                    value,
                },
            });
        }

        return this.buildStateByRoom(room.id);
    }

    /** Owner oyları açıklar. */
    async reveal(code: string, userId: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const actor = await this.getParticipantByUserOrThrow(room.id, userId);
        if (!actor.isOwner) throw new ForbiddenException('Only owner can reveal');

        const round = await this.prisma.round.findFirst({
            where: { roomId: room.id, status: 'voting' },
            orderBy: { startedAt: 'desc' },
        });
        if (!round) throw new BadRequestException('No active voting round');

        await this.prisma.round.update({
            where: { id: round.id },
            data: { status: 'revealed', endedAt: new Date() },
        });

        return this.buildStateByRoom(room.id);
    }

    /** Owner yeni oylama için sıfırlar (yeni "pending" round). */
    async reset(code: string, userId: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const actor = await this.getParticipantByUserOrThrow(room.id, userId);
        if (!actor.isOwner) throw new ForbiddenException('Only owner can reset');

        return this.prisma.$transaction(async (tx) => {
            const current = await tx.round.findFirst({
                where: { roomId: room.id, status: { in: ['voting', 'revealed', 'pending'] } },
                orderBy: { startedAt: 'desc' },
            });
            if (current) {
                await tx.round.update({
                    where: { id: current.id },
                    data: { status: 'archived', endedAt: new Date() },
                });
            }

            await tx.round.create({
                data: {
                    roomId: room.id,
                    storyId: null,
                    status: 'pending',
                    startedAt: new Date(),
                },
            });

            // ✅ tx içinden state
            return this.buildStateByRoomTx(tx, room.id);
        });
    }

    /** ----------------------------------------
     *  Private helpers
     *  ---------------------------------------- */

    private async getParticipantByUserOrThrow(roomId: string, userId: string) {
        const p = await this.prisma.participant.findFirst({
            where: { roomId, userId },
        });
        if (!p) throw new NotFoundException('Participant not found for user');
        return p;
    }

    private async buildStateByRoom(roomId: string) {
        const room = await this.prisma.room.findUnique({
            where: { id: roomId },
            include: {
                participants: true,
                rounds: {
                    orderBy: { startedAt: 'desc' },
                    take: 1,
                    include: { votes: true },
                },
            },
        });
        if (!room) throw new NotFoundException('Room not found');
        return this.normalizeState(room);
    }

    // ✅ Transaction içinden state toplama – doğru tip: Prisma.TransactionClient
    private async buildStateByRoomTx(tx: Prisma.TransactionClient, roomId: string) {
        const room = await tx.room.findUnique({
            where: { id: roomId },
            include: {
                participants: true,
                rounds: {
                    orderBy: { startedAt: 'desc' },
                    take: 1,
                    include: { votes: true },
                },
            },
        });
        if (!room) throw new NotFoundException('Room not found');
        return this.normalizeState(room);
    }

    private normalizeState(room: any) {
        const latest = room.rounds[0] ?? null;
        const votes = latest?.votes ?? [];
        const votedSet = new Set<string>(votes.map((v: any) => v.participantId));

        const participants = room.participants.map((p: any) => ({
            id: p.id,
            displayName: p.displayName,
            isOwner: p.isOwner,
            hasVoted: latest?.status === 'voting' ? votedSet.has(p.id) : false,
        }));

        const state: Json = {
            room: { id: room.id, code: room.code, name: room.name, deckType: room.deckType },
            participants,
            round: latest ? { id: latest.id, status: latest.status, storyId: latest.storyId } : null,
        };

        if (latest?.status === 'revealed') {
            const avg = this.computeAverage(votes.map((v: any) => v.value));
            state.votes = votes.map((v: any) => ({
                participantId: v.participantId,
                value: v.value,
                roundId: v.roundId,
            }));
            state.average = avg;
        }

        return state;
    }

    private computeAverage(values: string[]) {
        const nums = values
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n)) as number[];
        if (!nums.length) return null;
        const sum = nums.reduce((a, b) => a + b, 0);
        return Number((sum / nums.length).toFixed(2));
    }

    private async generateUniqueCode(): Promise<string> {
        // 6 karakterlik (hex) ve benzersiz oda kodu
        for (let attempt = 0; attempt < 8; attempt++) {
            const code = randomBytes(3).toString('hex').toUpperCase(); // 6 hex char
            const existing = await this.prisma.room.findUnique({ where: { code } });
            if (!existing) return code;
        }
        throw new BadRequestException('Unable to generate unique room code');
    }
}
