const socketIo = require('socket.io');
const User = require('../models/User');

let io;
const userSockets = new Map(); // Track userId -> socketId mapping

const initSocket = (server) => {
    io = socketIo(server, {
        cors: {
            origin: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5175", "http://127.0.0.1:5175"],
            methods: ["GET", "POST"]
        },
        pingTimeout: 60000,
        pingInterval: 25000
    });

    io.on('connection', async (socket) => {
        console.log('New client connected:', socket.id);
        let currentUserId = null;

        // User joins their own room identified by userId
        socket.on('join', async (userId) => {
            try {
                currentUserId = userId.toString();
                socket.join(currentUserId);
                userSockets.set(currentUserId, socket.id);
                
                // Update user online status
                await User.findByIdAndUpdate(currentUserId, {
                    isOnline: true,
                    lastSeen: new Date()
                });

                // Notify contacts that user is online
                const user = await User.findById(currentUserId);
                if (user) {
                    // Get all users who have chats with this user
                    const Chat = require('../models/Chat');
                    const chats = await Chat.find({
                        participants: currentUserId
                    }).select('participants');

                    const contactIds = new Set();
                    chats.forEach(chat => {
                        chat.participants.forEach(p => {
                            if (p.toString() !== currentUserId) {
                                contactIds.add(p.toString());
                            }
                        });
                    });

                    contactIds.forEach(contactId => {
                        io.to(contactId).emit('userStatusChange', {
                            userId: currentUserId,
                            isOnline: true
                        });
                    });
                }

                console.log(`User ${currentUserId} active and joined room ${currentUserId}`);
            } catch (error) {
                console.error('Join error:', error);
            }
        });

        // Typing indicator
        socket.on('typing', ({ recipientId, isTyping }) => {
            if (!currentUserId) return;
            
            io.to(recipientId.toString()).emit('typing', {
                senderId: currentUserId,
                isTyping: isTyping !== false
            });
        });

        // Stop typing indicator
        socket.on('stopTyping', ({ recipientId }) => {
            if (!currentUserId) return;
            
            io.to(recipientId.toString()).emit('typing', {
                senderId: currentUserId,
                isTyping: false
            });
        });

        // Handle message read status
        socket.on('messageRead', async ({ messageId, senderId }) => {
            if (!currentUserId) return;

            try {
                const Message = require('../models/Message');
                const message = await Message.findById(messageId);
                
                if (message && message.senderId.toString() === senderId) {
                    message.status = 'read';
                    await message.save();

                    // Notify original sender
                    io.to(senderId.toString()).emit('messageStatusUpdate', {
                        messageId,
                        status: 'read'
                    });
                }
            } catch (error) {
                console.error('Message read error:', error);
            }
        });

        // Handle disconnect
        socket.on('disconnect', async () => {
            console.log('Client disconnected:', socket.id);
            
            if (currentUserId) {
                userSockets.delete(currentUserId);

                // Update user offline status
                try {
                    await User.findByIdAndUpdate(currentUserId, {
                        isOnline: false,
                        lastSeen: new Date()
                    });

                    // Notify contacts that user is offline
                    const Chat = require('../models/Chat');
                    const chats = await Chat.find({
                        participants: currentUserId
                    }).select('participants');

                    const contactIds = new Set();
                    chats.forEach(chat => {
                        chat.participants.forEach(p => {
                            if (p.toString() !== currentUserId) {
                                contactIds.add(p.toString());
                            }
                        });
                    });

                    contactIds.forEach(contactId => {
                        io.to(contactId).emit('userStatusChange', {
                            userId: currentUserId,
                            isOnline: false
                        });
                    });
                } catch (error) {
                    console.error('Disconnect error:', error);
                }
            }
        });

        // Handle reconnection
        socket.on('reconnect', async () => {
            console.log('Client reconnected:', socket.id);
            if (currentUserId) {
                await User.findByIdAndUpdate(currentUserId, {
                    isOnline: true,
                    lastSeen: new Date()
                });
            }
        });
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};

module.exports = { initSocket, getIO };
