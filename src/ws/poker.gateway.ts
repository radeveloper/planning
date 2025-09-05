import {
    WebSocketGateway,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
    WebSocketServer,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RoomsService } from '../rooms/rooms.service';

@WebSocketGateway({ namespace: '/poker', cors: { origin: '*', credentials: false } })
export class PokerGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server!: Server;

    constructor(
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
        private readonly rooms: RoomsService,
    ) {}

    async handleConnection(client: Socket) {
        try {
            const token =
                client.handshake.auth?.token ||
                client.handshake.headers?.authorization?.replace(/^Bearer /, '');
            if (!token) throw new Error('No token');

            const payload: any = await this.jwt.verifyAsync(token, {
                secret: this.config.get<string>('JWT_SECRET'),
            });

            // userId'i payload.userId veya payload.sub'tan al
            const uid = (payload?.userId ?? payload?.sub)?.toString?.();
            if (!uid) throw new Error('No user id in token');

            client.data.userId = uid;
            client.data.displayName = payload?.displayName;
        } catch {
            client.emit('error', { code: 'UNAUTHORIZED', message: 'invalid token' });
            client.disconnect(true);
        }
    }
    async handleDisconnect(_client: Socket) {}

    private roomChannel(roomId: string) {
        return `room:${roomId}`;
    }

    @SubscribeMessage('join_room')
    async onJoinRoom(@MessageBody() body: { code?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code; // fallback
        if (!code) return client.emit('error', { code: 'BAD_REQUEST', message: 'code required' });

        try {
            const state = await this.rooms.buildStateByCode(code);

            // participantId’yi displayName ile tahmin et ve sakla
            let yourParticipantId: string | undefined;
            if (client.data.displayName) {
                const me = state.participants
                    .slice()
                    .reverse()
                    .find((p) => p.displayName === client.data.displayName);
                yourParticipantId = me?.id;
            }

            client.data.code = code;
            client.data.participantId = yourParticipantId;

            const channel = this.roomChannel(state.room.id);
            client.join(channel);
            client.emit('room_state', state);
            client.emit('participant_self', { participantId: yourParticipantId });

            return { ok: true, roomId: state.room.id, participantId: yourParticipantId };
        } catch (e: any) {
            client.emit('error', { code: 'JOIN_FAILED', message: e.message ?? 'join failed' });
        }
    }

    @SubscribeMessage('start_voting')
    async onStartVoting(@MessageBody() body: { code?: string; storyId?: string | null }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const storyId = body?.storyId ?? null;
        const userId = client.data.userId as string;
        if (!code) return client.emit('error', { code: 'BAD_REQUEST', message: 'code required' });
        if (!userId) return client.emit('error', { code: 'UNAUTHORIZED', message: 'no user' });

        try {
            const state = await this.rooms.startVoting(code, storyId, userId);
            const channel = `room:${state.room.id}`;
            client.join(channel);
            client.emit('voting_started', { round: state.round });
            this.server.to(channel).emit('room_state', state);
        } catch (e: any) {
            client.emit('error', { code: 'START_FAILED', message: e.message ?? 'start failed' });
        }
    }

    @SubscribeMessage('vote')
    async onVote(@MessageBody() body: { code?: string; value?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const value = body?.value;
        const userId = client.data.userId as string;
        if (!code) return client.emit('error', { code: 'BAD_REQUEST', message: 'code required' });
        if (!userId) return client.emit('error', { code: 'UNAUTHORIZED', message: 'no user' });
        if (typeof value !== 'string') return client.emit('error', { code: 'BAD_REQUEST', message: 'value required' });

        try {
            const state = await this.rooms.castVoteByUser(code, userId, value);
            const channel = `room:${state.room.id}`;
            this.server.to(channel).emit('room_state', state);
            client.emit('vote_cast_ack', { ok: true });
        } catch (e: any) {
            client.emit('error', { code: 'VOTE_FAILED', message: e.message ?? 'vote failed' });
        }
    }

    @SubscribeMessage('reveal')
    async onReveal(@MessageBody() body: { code?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const userId = client.data.userId as string;
        if (!code) return client.emit('error', { code: 'BAD_REQUEST', message: 'code required' });
        if (!userId) return client.emit('error', { code: 'UNAUTHORIZED', message: 'no user' });

        try {
            const state = await this.rooms.reveal(code, userId);
            const channel = `room:${state.room.id}`;
            this.server.to(channel).emit('revealed', { round: state.round, votes: state.votes, average: state.average });
            this.server.to(channel).emit('room_state', state);
        } catch (e: any) {
            client.emit('error', { code: 'REVEAL_FAILED', message: e.message ?? 'reveal failed' });
        }
    }

    @SubscribeMessage('reset')
    async onReset(@MessageBody() body: { code?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const userId = client.data.userId as string;
        if (!code) return client.emit('error', { code: 'BAD_REQUEST', message: 'code required' });
        if (!userId) return client.emit('error', { code: 'UNAUTHORIZED', message: 'no user' });

        try {
            const state = await this.rooms.reset(code, userId);
            const channel = `room:${state.room.id}`;
            this.server.to(channel).emit('reset_done', { round: state.round });
            this.server.to(channel).emit('room_state', state);
        } catch (e: any) {
            client.emit('error', { code: 'RESET_FAILED', message: e.message ?? 'reset failed' });
        }
    }

}
