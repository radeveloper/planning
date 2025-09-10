import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';

type Json = Record<string, any>;
const ONLINE_GRACE_MS = Number(process.env.PRESENCE_GRACE_MS ?? 30_000);

@Injectable()
export class RoomsService {
    constructor(private readonly prisma: PrismaService) {}

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
                    userId,
                    lastSeenAt: new Date(),
                    leftAt: null,
                },
            });

            return { room, participant };
        });
    }

    /** Var olan odaya userId bağlı participant ekler (veya varsa günceller). */
    async joinRoom(code: string, userId: string, displayName: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const existing = await this.prisma.participant.findFirst({
            where: { roomId: room.id, userId },
        });

        const participant = existing
            ? await this.prisma.participant.update({
                where: { id: existing.id },
                data: { displayName, leftAt: null, lastSeenAt: new Date() },
            })
            : await this.prisma.participant.create({
                data: {
                    roomId: room.id,
                    displayName,
                    userId,
                    isOwner: false,
                    lastSeenAt: new Date(),
                    leftAt: null,
                },
            });

        return { room, participant };
    }

    /** Bilinçli ayrılma. Owner ise devri zorunlu (başkası varsa). */
    async leave(code: string, userId: string, transferToParticipantId?: string | null) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const me = await this.getParticipantByUserOrThrow(room.id, userId);

        return this.prisma.$transaction(async (tx) => {
            if (me.isOwner) {
                const others = await tx.participant.findMany({
                    where: { roomId: room.id, id: { not: me.id }, leftAt: null },
                    select: { id: true },
                });
                if (others.length > 0) {
                    if (!transferToParticipantId) {
                        throw new BadRequestException('Owner must transfer before leaving');
                    }
                    const ok = others.some((p) => p.id === transferToParticipantId);
                    if (!ok) throw new BadRequestException('Invalid transferee');
                    await tx.participant.update({
                        where: { id: me.id },
                        data: { isOwner: false },
                    });
                    await tx.participant.update({
                        where: { id: transferToParticipantId },
                        data: { isOwner: true },
                    });
                }
            }

            await tx.participant.update({
                where: { id: me.id },
                data: { leftAt: new Date(), lastSeenAt: new Date() },
            });

            return this.buildStateByRoomTx(tx, room.id);
        });
    }

    /** Owner devrini tek başına yapmak isterse (ayrı endpoint/WS). */
    async transferOwner(code: string, userId: string, toParticipantId: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const me = await this.getParticipantByUserOrThrow(room.id, userId);
        if (!me.isOwner) throw new ForbiddenException('Only owner can transfer');

        const target = await this.prisma.participant.findFirst({
            where: { id: toParticipantId, roomId: room.id, leftAt: null },
        });
        if (!target) throw new BadRequestException('Invalid target');

        await this.prisma.$transaction(async (tx) => {
            await tx.participant.update({ where: { id: me.id }, data: { isOwner: false } });
            await tx.participant.update({ where: { id: target.id }, data: { isOwner: true } });
        });

        return this.buildStateByRoom(room.id);
    }

    /** Pasif kopmada presence yenile (leftAt dokunma). */
    async touchPresence(code: string, userId: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const me = await this.getParticipantByUserOrThrow(room.id, userId);
        await this.prisma.participant.update({
            where: { id: me.id },
            data: { lastSeenAt: new Date() },
        });

        return this.buildStateByRoom(room.id);
    }

    /** Kodla odayı ve son round’u getirir. */
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

    /** Owner başlatır. */
    /** Owner başlatır. */
    async startVoting(code: string, storyId: string | null, userId: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const actor = await this.getParticipantByUserOrThrow(room.id, userId);
        if (!actor.isOwner) throw new ForbiddenException('Only owner can start voting');

        return this.prisma.$transaction(async (tx) => {
            // 🟢 EN AZ 2 AKTİF KATILIMCI KONTROLÜ — transaction’ın EN BAŞINDA
            const now = new Date();
            const minSeen = new Date(now.getTime() - ONLINE_GRACE_MS);

            const activeCount = await tx.participant.count({
                where: {
                    roomId: room.id,
                    leftAt: null,
                    lastSeenAt: { gte: minSeen },
                },
            });

            if (activeCount < 2) {
                throw new BadRequestException('At least two participants required to start voting');
            }

            // 🟡 Mevcut pending/voting round’u arşivle
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

            // 🟣 Yeni round’u başlat
            await tx.round.create({
                data: {
                    roomId: room.id,
                    storyId,
                    status: 'voting',
                    startedAt: new Date(),
                },
            });

            // 🔵 Güncel state’i dön
            return this.buildStateByRoomTx(tx, room.id);
        });
    }


    /** Oy atar. */
    async castVoteByUser(code: string, userId: string, value: string) {
        const room = await this.prisma.room.findUnique({ where: { code } });
        if (!room) throw new NotFoundException('Room not found');

        const participant = await this.getParticipantByUserOrThrow(room.id, userId);

        const round = await this.prisma.round.findFirst({
            where: { roomId: room.id, status: 'voting' },
            orderBy: { startedAt: 'desc' },
        });
        if (!round) throw new BadRequestException('No active voting round');

        // Vote upsert (composite unique varsa direkt upsert; yoksa manual)
        const existing = await this.prisma.vote.findFirst({
            where: { participantId: participant.id, roundId: round.id },
            select: { id: true },
        });

        if (existing) {
            await this.prisma.vote.update({ where: { id: existing.id }, data: { value } });
        } else {
            await this.prisma.vote.create({
                data: { participantId: participant.id, roundId: round.id, value },
            });
        }

        return this.buildStateByRoom(room.id);
    }

    /** Reveal. */
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

    /** Reset. */
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

            return this.buildStateByRoomTx(tx, room.id);
        });
    }

    /** ----------------- Private ----------------- */

    private async getParticipantByUserOrThrow(roomId: string, userId: string) {
        const p = await this.prisma.participant.findFirst({ where: { roomId, userId } });
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
        const now = Date.now();
        const latest = room.rounds[0] ?? null;
        const votes = latest?.votes ?? [];
        const votedSet = new Set<string>(votes.map((v: any) => v.participantId));
        const alive = room.participants.filter((p: any) => !p.leftAt);

        const participants = alive.map((p: any) => {
            const online = !p.leftAt && now - new Date(p.lastSeenAt).getTime() <= ONLINE_GRACE_MS;
            return {
                id: p.id,
                displayName: p.displayName,
                isOwner: p.isOwner,
                hasVoted: latest?.status === 'voting' ? votedSet.has(p.id) : false,
                isOnline: online,
            };
        });

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
        const nums = values.map((v) => Number(v)).filter((n) => Number.isFinite(n)) as number[];
        if (!nums.length) return null;
        const sum = nums.reduce((a, b) => a + b, 0);
        return Number((sum / nums.length).toFixed(2));
    }

    private async generateUniqueCode(): Promise<string> {
        for (let attempt = 0; attempt < 8; attempt++) {
            const code = randomBytes(3).toString('hex').toUpperCase();
            const existing = await this.prisma.room.findUnique({ where: { code } });
            if (!existing) return code;
        }
        throw new BadRequestException('Unable to generate unique room code');
    }
}
