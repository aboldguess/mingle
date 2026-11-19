import { AccessToken, RoomServiceClient, TokenVerifier, TrackSource, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { Config } from '../config.js';

export interface JoinGrant {
  roomName: string;
  identity: string;
  name: string;
  isHost: boolean;
  /** Seconds the token stays valid for joining. */
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Thin wrapper around LiveKit so routes stay testable: tests swap in a fake
 * that records calls instead of talking to a media server.
 */
export interface MediaService {
  readonly url: string;
  createJoinToken(grant: JoinGrant): Promise<string>;
  ensureRoom(roomName: string, opts: { maxParticipants: number; emptyTimeoutSeconds?: number }): Promise<void>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  muteParticipant(roomName: string, identity: string): Promise<void>;
  endRoom(roomName: string): Promise<void>;
  listParticipantCount(roomName: string): Promise<number>;
  receiveWebhook(body: string, authHeader: string | undefined): Promise<WebhookEvent>;
  /** Check a join token we issued: which room and who it admits, or null if it isn't valid. */
  verifyJoinToken(token: string): Promise<{ room: string; identity: string } | null>;
}

/** LiveKit's HTTP API uses http(s); clients connect over ws(s). */
function toHttpUrl(url: string): string {
  return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

export function createLiveKitService(config: Config): MediaService {
  const rooms = new RoomServiceClient(config.LIVEKIT_API_URL ?? toHttpUrl(config.LIVEKIT_URL), config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  const receiver = new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  const verifier = new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

  return {
    url: config.LIVEKIT_URL,

    async createJoinToken(grant) {
      const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
        identity: grant.identity,
        name: grant.name,
        ttl: grant.ttlSeconds ?? 60 * 60 * 6,
        metadata: JSON.stringify({ ...grant.metadata, isHost: grant.isHost }),
      });
      token.addGrant({
        room: grant.roomName,
        roomJoin: true,
        roomAdmin: grant.isHost,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
      });
      return token.toJwt();
    },

    async ensureRoom(roomName, opts) {
      await rooms.createRoom({
        name: roomName,
        maxParticipants: opts.maxParticipants,
        emptyTimeout: opts.emptyTimeoutSeconds ?? 5 * 60,
      });
    },

    async removeParticipant(roomName, identity) {
      await rooms.removeParticipant(roomName, identity);
    },

    async muteParticipant(roomName, identity) {
      const participant = await rooms.getParticipant(roomName, identity);
      for (const track of participant.tracks) {
        if (track.source === TrackSource.MICROPHONE && !track.muted) {
          await rooms.mutePublishedTrack(roomName, identity, track.sid, true);
        }
      }
    },

    async endRoom(roomName) {
      try {
        await rooms.deleteRoom(roomName);
      } catch (err) {
        // Deleting a room that no longer exists is fine.
        if (!String(err).includes('not found')) throw err;
      }
    },

    async listParticipantCount(roomName) {
      try {
        const list = await rooms.listParticipants(roomName);
        return list.length;
      } catch {
        return 0;
      }
    },

    async receiveWebhook(body, authHeader) {
      return receiver.receive(body, authHeader);
    },

    async verifyJoinToken(token) {
      try {
        const claims = await verifier.verify(token);
        if (!claims.video?.roomJoin || !claims.video.room || !claims.sub) return null;
        return { room: claims.video.room, identity: claims.sub };
      } catch {
        return null;
      }
    },
  };
}

export const roomNameFor = (meetingCode: string) => `mingle-${meetingCode}`;
