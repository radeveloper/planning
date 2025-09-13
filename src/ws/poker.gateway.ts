import {
    WebSocketGateway,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
    WebSocketServer,
} from '@nestjs/websockets';
import {Socket, Server} from 'socket.io';
import {JwtService} from '@nestjs/jwt';
import {ConfigService} from '@nestjs/config';
import {RoomsService} from '../rooms/rooms.service';

@WebSocketGateway({namespace: '/poker', cors: {origin: '*', credentials: false}})
export class PokerGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server!: Server;

    constructor(
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
        private readonly rooms: RoomsService,
    ) {
    }

    async handleConnection(client: Socket) {
        try {
            const token =
                client.handshake.auth?.token ||
                client.handshake.headers?.authorization?.replace(/^Bearer /, '');
            if (!token) {
                client.emit('error', {code: 'UNAUTHORIZED', message: 'No token'});
                client.disconnect(true);
                return;
            }

            const payload: any = await this.jwt.verifyAsync(token, {
                secret: this.config.get<string>('JWT_SECRET'),
            });

            // userId'i payload.userId veya payload.sub'tan al
            const uid = (payload?.userId ?? payload?.sub)?.toString?.();
            if (!uid) {
                client.emit('error', {code: 'UNAUTHORIZED', message: 'No user id in token'});
                client.disconnect(true);
                return;
            }

            client.data.userId = uid;
            client.data.displayName = payload?.displayName;
        } catch {
            client.emit('error', {code: 'UNAUTHORIZED', message: 'invalid token'});
            client.disconnect(true);
        }
    }

    async handleDisconnect(client: Socket) {
        try {
            const code = client.data.code;
            const userId = client.data.userId as string | undefined;
            if (code && userId) {
                await this.rooms.touchPresence(code, userId);
                const state = await this.rooms.buildStateByCode(code);
                const channel = `room:${state.room.id}`;
                this.server.to(channel).emit('room_state', state);
            }
        } catch {
        }
    }

    @SubscribeMessage('presence_touch')
    async onPresenceTouch(@MessageBody() body: { code?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const userId = client.data.userId as string;
        if (!code || !userId) return;
        await this.rooms.touchPresence(code, userId);
    }

    private roomChannel(roomId: string) {
        return `room:${roomId}`;
    }

    @SubscribeMessage('join_room')
    async onJoinRoom(
        @MessageBody() body: { code?: string },
        @ConnectedSocket() client: Socket,
    ) {
        const code = body?.code ?? client.data.code;
        const userId = client.data.userId as string | undefined;

        if (!code) {
            return client.emit('error', { code: 'BAD_REQUEST', message: 'code required' });
        }
        if (!userId) {
            return client.emit('error', { code: 'UNAUTHORIZED', message: 'no user' });
        }

        try {
            // Code'u client state'e yaz ve presence güncelle
            client.data.code = code;
            await this.rooms.touchPresence(code, userId);

            // Participant'ı DB'den KESİN olarak bul
            const me = await this.rooms.findParticipantByUserInRoom(code, userId);
            if (!me) {
                return client.emit('error', { code: 'JOIN_FAILED', message: 'participant not found in room' });
            }
            const participantId = me.id;
            client.data.participantId = participantId;

            // Odanın güncel snapshot'ını al
            const state = await this.rooms.buildStateByCode(code);

            // Oda kanalına katıl
            const channel = this.roomChannel(state.room.id);
            await client.join(channel);

            // Odaya güncel state yayınla
            this.server.to(channel).emit('room_state', state);

            // İstemciye kendi participant bilgisini bildir
            client.emit('participant_self', { participantId });

            // Join ACK
            return { ok: true, roomId: state.room.id, participantId };
        } catch (e: any) {
            client.emit('error', { code: 'JOIN_FAILED', message: e.message ?? 'join failed' });
        }
    }


    @SubscribeMessage('leave_room')
    async onLeaveRoom(@MessageBody() body: { code?: string; transferToParticipantId?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const userId = client.data.userId as string;
        if (!code || !userId) return client.emit('error', { code: 'BAD_REQUEST', message: 'code/user required' });

        try {
            const state = await this.rooms.leave(code, userId, body?.transferToParticipantId);
            const channel = `room:${state.room.id}`;
            this.server.to(channel).emit('room_state', state);
            client.emit('left_ack', { ok: true });
            client.leave(channel);
            client.disconnect(true);
        } catch (e: any) {
            client.emit('error', { code: 'LEAVE_FAILED', message: e.message ?? 'leave failed' });
        }
    }

    @SubscribeMessage('start_voting')
    async onStartVoting(
        @MessageBody() body: { code?: string; storyId?: string | null },
        @ConnectedSocket() client: Socket,
    ) {
        const code = body?.code ?? client.data.code;
        const storyId = body?.storyId ?? null;
        const userId = client.data.userId as string;
        if (!code) return client.emit('error', {code: 'BAD_REQUEST', message: 'code required'});
        if (!userId) return client.emit('error', {code: 'UNAUTHORIZED', message: 'no user'});

        try {
            await this.rooms.touchPresence(code, userId);
            const state = await this.rooms.startVoting(code, storyId, userId);
            const channel = this.roomChannel(state.room.id);
            await client.join(channel);
            client.emit('voting_started', {round: state.round});
            this.server.to(channel).emit('room_state', state);
        } catch (e: any) {
            client.emit('error', {code: 'START_FAILED', message: e.message ?? 'start failed'});
        }
    }

    @SubscribeMessage('vote')
    async onVote(
        @MessageBody() body: { code?: string; value?: string },
        @ConnectedSocket() client: Socket,
    ) {
        const code = body?.code ?? client.data.code;
        const value = body?.value;
        const userId = client.data.userId as string;

        if (!code) return client.emit('error', {code: 'BAD_REQUEST', message: 'code required'});
        if (!userId) return client.emit('error', {code: 'UNAUTHORIZED', message: 'no user'});
        if (typeof value !== 'string') {
            return client.emit('error', {code: 'BAD_REQUEST', message: 'value required'});
        }

        try {
            await this.rooms.touchPresence(code, userId);
            const state = await this.rooms.castVoteByUser(code, userId, value);
            const channel = `room:${state.room.id}`;
            this.server.to(channel).emit('room_state', state); // herkese güncel durum
            client.emit('vote_cast_ack', {ok: true});
        } catch (e: any) {
            client.emit('error', {code: 'VOTE_FAILED', message: e.message ?? 'vote failed'});
        }
    }

    @SubscribeMessage('reveal')
    async onReveal(@MessageBody() body: { code?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const userId = client.data.userId as string;
        if (!code) return client.emit('error', {code: 'BAD_REQUEST', message: 'code required'});
        if (!userId) return client.emit('error', {code: 'UNAUTHORIZED', message: 'no user'});

        try {
            const state = await this.rooms.reveal(code, userId);
            const channel = this.roomChannel(state.room.id);
            this.server.to(channel).emit('revealed', {
                round: state.round,
                votes: state.votes,
                average: state.average,
            });
            this.server.to(channel).emit('room_state', state);
        } catch (e: any) {
            client.emit('error', {code: 'REVEAL_FAILED', message: e.message ?? 'reveal failed'});
        }
    }

    @SubscribeMessage('reset')
    async onReset(@MessageBody() body: { code?: string }, @ConnectedSocket() client: Socket) {
        const code = body?.code ?? client.data.code;
        const userId = client.data.userId as string;
        if (!code) return client.emit('error', {code: 'BAD_REQUEST', message: 'code required'});
        if (!userId) return client.emit('error', {code: 'UNAUTHORIZED', message: 'no user'});

        try {
            const state = await this.rooms.reset(code, userId);
            const channel = this.roomChannel(state.room.id);
            this.server.to(channel).emit('reset_done', {round: state.round});
            this.server.to(channel).emit('room_state', state);
        } catch (e: any) {
            client.emit('error', {code: 'RESET_FAILED', message: e.message ?? 'reset failed'});
        }
    }

    @SubscribeMessage('kick_participant')
    async onKickParticipant(
        @MessageBody() body: { code?: string; participantId?: string },
        @ConnectedSocket() client: Socket,
    ) {
        const code = body?.code ?? client.data.code;
        const targetParticipantId = body?.participantId;
        const userId = client.data.userId as string;

        if (!code) return client.emit('error', { code: 'BAD_REQUEST', message: 'code required' });
        if (!userId) return client.emit('error', { code: 'UNAUTHORIZED', message: 'no user' });
        if (!targetParticipantId) return client.emit('error', { code: 'BAD_REQUEST', message: 'participantId required' });

        try {
            // 1) DB'de kick et ve state'i al
            const state = await this.rooms.kickParticipant(code, userId, targetParticipantId);
            const channel = `room:${state.room.id}`;

            // 2) Odaya güncel state yayınla
            this.server.to(channel).emit('room_state', state);

            // 3) Hedef kullanıcının userId'sini bul
            const targetUserId = await this.rooms.getUserIdByParticipantId(targetParticipantId);

            // 4) Namespace içindeki tüm soketleri tara ve hedefi kopar
            const sockets = await this.server.fetchSockets(); // this.server: Namespace
            for (const s of sockets) {
                const sData = s.data as any;
                const sCode = sData?.code;
                const sPid  = sData?.participantId;
                const sUid  = sData?.userId;

                // Eşleşme koşulları: aynı oda + (participantId eşitliği veya userId eşitliği)
                const match =
                    sCode === code && (
                        (sPid && sPid === targetParticipantId) ||
                        (targetUserId && sUid === targetUserId)
                    );

                if (match) {
                    s.emit('kicked', { message: 'You have been removed from the room' });
                    s.leave(channel);
                    s.disconnect(true);
                }
            }
            // 5) Kick ACK
            client.emit('kick_ack', { ok: true });
        } catch (e: any) {
            client.emit('error', { code: 'KICK_FAILED', message: e.message ?? 'kick failed' });
        }
    }

}
