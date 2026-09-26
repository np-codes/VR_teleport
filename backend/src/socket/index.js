import { Server } from 'socket.io';
import { config } from '../config.js';
import { findUserById } from '../data/users.js';
import { verifyToken } from '../middleware/requireAuth.js';

// userId -> socket id (who is online right now)
const onlineUsers = new Map();
// userId -> the other userId in their call (ringing or connected)
const activeCalls = new Map();

// Events that are simply passed along to the other person in the call.
const RELAY_EVENTS = [
  'call:ringing',
  'call:accept',
  'call:decline',
  'call:cancel',
  'call:end',
  'call:busy',
  'webrtc:offer',
  'webrtc:answer',
  'webrtc:ice-candidate',
];

// After these events the call is over, so both users are free again.
const CALL_ENDING_EVENTS = ['call:decline', 'call:cancel', 'call:end', 'call:busy'];

export function isOnline(userId) {
  return onlineUsers.has(userId);
}

function startCall(userA, userB) {
  activeCalls.set(userA, userB);
  activeCalls.set(userB, userA);
}

function finishCall(userId) {
  const peerId = activeCalls.get(userId);
  activeCalls.delete(userId);
  if (peerId && activeCalls.get(peerId) === userId) activeCalls.delete(peerId);
  return peerId;
}

function isValidPayload(payload) {
  return payload !== null && typeof payload === 'object' && typeof payload.to === 'string';
}

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin },
  });

  const sendTo = (userId, event, data) => {
    const socketId = onlineUsers.get(userId);
    if (socketId) io.to(socketId).emit(event, data);
  };

  // Only allow connections with a valid, unexpired JWT.
  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;

    // If the same user opens a second tab, the newest connection wins.
    const previousSocketId = onlineUsers.get(user.id);
    if (previousSocketId) io.sockets.sockets.get(previousSocketId)?.disconnect(true);

    onlineUsers.set(user.id, socket.id);
    console.log(`[socket] ${user.name} is online`);
    io.emit('presence', { userId: user.id, online: true });

    socket.on('call:invite', (payload) => {
      if (!isValidPayload(payload)) return;
      const callee = findUserById(payload.to);

      if (!callee || callee.id === user.id) {
        socket.emit('call:error', { error: 'That person cannot be called.' });
        return;
      }
      if (activeCalls.has(user.id)) {
        socket.emit('call:error', { error: 'You are already in a call.' });
        return;
      }
      if (!isOnline(callee.id)) {
        console.log(`[call] ${user.name} called ${callee.name}, who is offline`);
        socket.emit('call:unavailable', { from: callee.id });
        return;
      }
      if (activeCalls.has(callee.id)) {
        console.log(`[call] ${user.name} called ${callee.name}, who is busy`);
        socket.emit('call:busy', { from: callee.id });
        return;
      }

      startCall(user.id, callee.id);
      console.log(`[call] ${user.name} is calling ${callee.name}`);
      sendTo(callee.id, 'call:invite', { from: user.id, fromName: user.name });
    });

    for (const event of RELAY_EVENTS) {
      socket.on(event, (payload) => {
        if (!isValidPayload(payload)) return;

        // Only relay between the two people who are actually in this call.
        if (activeCalls.get(user.id) !== payload.to) return;

        if (CALL_ENDING_EVENTS.includes(event)) {
          finishCall(user.id);
          console.log(`[call] ${user.name} sent ${event}`);
        } else if (event === 'call:accept') {
          console.log(`[call] ${user.name} accepted the call`);
        }

        const { to, ...data } = payload;
        sendTo(to, event, { ...data, from: user.id });
      });
    }

    socket.on('disconnect', () => {
      // Ignore old sockets that were replaced by a newer tab.
      if (onlineUsers.get(user.id) !== socket.id) return;

      const peerId = finishCall(user.id);
      if (peerId) {
        console.log(`[call] ${user.name} disconnected during a call`);
        sendTo(peerId, 'call:end', { from: user.id, reason: 'disconnected' });
      }

      onlineUsers.delete(user.id);
      console.log(`[socket] ${user.name} went offline`);
      io.emit('presence', { userId: user.id, online: false });
    });
  });

  return io;
}
