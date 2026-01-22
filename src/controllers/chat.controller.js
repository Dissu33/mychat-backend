const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Contact = require('../models/Contact');
const { getIO } = require('../socket/socket');
const { validateMessage, sanitizeText } = require('../middleware/upload.middleware');

/**
 * Upload media file (image, video, audio)
 */
exports.uploadMedia = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const fileType = req.body.fileType || 'image'; // image, video, audio
        const fileUrl = `/uploads/media/${req.file.filename}`;

        // Determine message type based on file type
        let messageType = 'image';
        if (fileType === 'video') messageType = 'video';
        if (fileType === 'audio') messageType = 'audio';

        res.status(200).json({
            url: fileUrl,
            mimeType: req.file.mimetype,
            size: req.file.size,
            type: messageType
        });
    } catch (error) {
        console.error('Upload Media Error:', error);
        res.status(500).json({ error: 'Failed to upload media' });
    }
};

/**
 * Send a message (text, media, or emoji)
 * Supports: text, image, audio, video, emoji
 */
exports.sendMessage = async (req, res) => {
    const { recipientId, text, type = 'text', media, forwardedFrom } = req.body;
    const senderId = req.userId;

    // Validation
    if (!recipientId) {
        return res.status(400).json({ error: 'Recipient is required' });
    }

    // Validate message data
    const validation = validateMessage({ type, text, media });
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    // Sanitize text if present
    const sanitizedText = text ? sanitizeText(text) : '';

    // Validate recipient exists
    const recipient = await User.findById(recipientId);
    if (!recipient) {
        return res.status(404).json({ error: 'Recipient not found' });
    }

    try {
        // Find or create chat
        let chat = await Chat.findOne({
            participants: { $all: [senderId, recipientId] }
        });

        if (!chat) {
            chat = await Chat.create({
                participants: [senderId, recipientId],
                unreadCount: new Map()
            });
        }

        // Create message
        const messageData = {
            chatId: chat._id,
            senderId,
            type,
            status: 'sent'
        };

        if (sanitizedText) messageData.text = sanitizedText;
        if (media) messageData.media = media;
        if (forwardedFrom) messageData.forwardedFrom = forwardedFrom;

        const message = await Message.create(messageData);

        // Populate sender info for real-time emission
        await message.populate('senderId', 'name phoneNumber profilePicture');

        // Update chat
        chat.lastMessage = message._id;

        // Unhide chat if it was hidden/deleted by either party so it reappears
        if (chat.deletedBy && chat.deletedBy.length > 0) {
            chat.deletedBy = chat.deletedBy.filter(id =>
                id.toString() !== senderId.toString() &&
                id.toString() !== recipientId.toString()
            );
        }

        const currentUnread = chat.unreadCount.get(recipientId.toString()) || 0;
        chat.unreadCount.set(recipientId.toString(), currentUnread + 1);
        await chat.save();

        // Emit to recipient
        try {
            getIO().to(recipientId.toString()).emit('newMessage', message);
            // Also emit to sender for confirmation
            getIO().to(senderId.toString()).emit('messageSent', message);
        } catch (socketError) {
            console.error('Socket Emission Error:', socketError.message);
        }

        // Auto-mark as delivered if recipient is online
        setTimeout(async () => {
            const recipientUser = await User.findById(recipientId);
            if (recipientUser?.isOnline) {
                await updateMessageStatus(message._id, 'delivered', senderId);
            }
        }, 100);

        res.status(201).json(message);
    } catch (error) {
        console.error('Send Message Error:', error);
        res.status(500).json({ error: error.message || 'Failed to send message' });
    }
};

/**
 * Get chat history with proper filtering (exclude deleted messages)
 */
exports.getChatHistory = async (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.userId;

    try {
        // Validate user exists
        const otherUser = await User.findById(userId);
        if (!otherUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const chat = await Chat.findOne({
            participants: { $all: [currentUserId, userId] }
        });

        if (!chat) {
            return res.status(200).json([]);
        }

        // Get messages, excluding those deleted for current user
        const messages = await Message.find({
            chatId: chat._id,
            isDeleted: false,
            deletedFor: { $ne: currentUserId }
        })
            .populate('senderId', 'name phoneNumber profilePicture')
            .populate('forwardedFrom', 'text type media')
            .sort({ createdAt: 1 });

        // Mark messages as read when user opens chat
        const unreadMessages = messages.filter(
            msg => msg.senderId && msg.senderId._id.toString() !== currentUserId.toString() &&
                msg.status !== 'read'
        );

        if (unreadMessages.length > 0) {
            await Message.updateMany(
                { _id: { $in: unreadMessages.map(m => m._id) } },
                { $set: { status: 'read' } }
            );

            // Emit read status updates to senders
            const senders = [...new Set(unreadMessages.map(m => m.senderId._id.toString()))];
            senders.forEach(senderId => {
                getIO().to(senderId).emit('messagesRead', {
                    chatId: chat._id.toString(),
                    readerId: currentUserId.toString()
                });
            });
        }

        // Reset unread count
        chat.unreadCount.set(currentUserId.toString(), 0);
        await chat.save();

        res.status(200).json(messages);
    } catch (error) {
        console.error('Get Chat History Error:', error);
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
};

/**
 * Get all chats for current user with unread counts and saved contact names
 */
exports.getChats = async (req, res) => {
    const currentUserId = req.userId;
    try {
        const chats = await Chat.find({
            participants: { $in: [currentUserId] },
            deletedBy: { $ne: currentUserId }, // Exclude hidden chats
            archivedBy: { $ne: currentUserId } // Exclude archived chats
        })
            .populate('participants', 'phoneNumber profilePicture about isOnline lastSeen privacySettings')
            .populate({
                path: 'lastMessage',
                populate: {
                    path: 'senderId',
                    select: 'phoneNumber'
                }
            })
            .sort({ updatedAt: -1 });

        // Get saved contact names for current user
        const contacts = await Contact.find({ userId: currentUserId });
        const contactMap = {};
        contacts.forEach(contact => {
            contactMap[contact.contactUserId.toString()] = contact.savedName;
        });

        // Format chats with unread count and saved names
        const formattedChats = chats.map(chat => {
            const otherParticipant = chat.participants.find(
                p => p && p._id.toString() !== currentUserId.toString()
            );
            const unreadCount = chat.unreadCount.get(currentUserId.toString()) || 0;

            // If other participant is deleted (null), we still return the chat but indicate deleted user
            if (!otherParticipant) {
                return {
                    ...chat.toObject(),
                    otherParticipant: {
                        _id: 'deleted',
                        phoneNumber: 'Deleted User',
                        displayName: 'Deleted User',
                        savedName: 'Deleted User',
                        profilePicture: null
                    },
                    unreadCount
                };
            }

            // Add saved name if exists
            const savedName = contactMap[otherParticipant._id.toString()] || null;
            const displayName = savedName || otherParticipant.phoneNumber;

            return {
                ...chat.toObject(),
                otherParticipant: {
                    ...otherParticipant.toObject(),
                    savedName,
                    displayName
                },
                unreadCount
            };
        });

        // Check for Default Support Contact
        const defaultSupportPhone = '+917888453659';

        // Only if current user is not the support user
        // We need to fetch current user's phone to check this, or just check ID if we knew it
        // Simpler: fetch support user first
        const supportUser = await User.findOne({ phoneNumber: defaultSupportPhone });

        if (supportUser && supportUser._id.toString() !== currentUserId.toString()) {
            // Check if already in chats
            const alreadyHasChat = formattedChats.some(chat =>
                chat.otherParticipant &&
                chat.otherParticipant._id.toString() === supportUser._id.toString()
            );

            if (!alreadyHasChat) {
                // Add virtual chat
                const savedName = contactMap[supportUser._id.toString()] || null;
                const displayName = savedName || supportUser.name || 'Team'; // Use 'Team' or name if set

                formattedChats.unshift({
                    _id: 'virtual_' + supportUser._id, // Client uses this for key
                    participants: [supportUser], // Simplified
                    unreadCount: 0,
                    lastMessage: null, // Shows as "No messages" or we can mock one
                    createdAt: new Date(),
                    updatedAt: new Date(), // Put it at the top
                    otherParticipant: {
                        ...supportUser.toObject(),
                        savedName,
                        displayName: displayName || supportUser.phoneNumber
                    }
                });
            }
        }

        res.status(200).json(formattedChats);
    } catch (error) {
        console.error('Get Chats Error:', error);
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
};

/**
 * Search user by phone number to start a new chat
 */
exports.searchUserByPhone = async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const currentUserId = req.userId;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Find user by phone number
        const user = await User.findOne({ phoneNumber });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user._id.toString() === currentUserId.toString()) {
            return res.status(400).json({ error: 'Cannot chat with yourself' });
        }

        // Check if chat already exists
        const existingChat = await Chat.findOne({
            participants: { $all: [currentUserId, user._id] }
        });

        res.status(200).json({
            user: {
                _id: user._id,
                phoneNumber: user.phoneNumber,
                profilePicture: user.profilePicture,
                about: user.about,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen,
                privacySettings: user.privacySettings
            },
            chatId: existingChat ? existingChat._id : null
        });

    } catch (error) {
        console.error('Search User Error:', error);
        res.status(500).json({ error: 'Failed to search user' });
    }
};

/**
 * Start a new chat with a user (creates empty chat or returns existing)
 */
exports.startChat = async (req, res) => {
    try {
        const { userId } = req.body;
        const currentUserId = req.userId;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Verify user exists
        const otherUser = await User.findById(userId);
        if (!otherUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if chat already exists
        let chat = await Chat.findOne({
            participants: { $all: [currentUserId, userId] }
        });

        if (!chat) {
            chat = await Chat.create({
                participants: [currentUserId, userId],
                unreadCount: new Map()
            });
        }

        // Populate participants for frontend
        await chat.populate('participants', 'phoneNumber profilePicture about isOnline lastSeen privacySettings');

        // Format for response
        const formattedChat = {
            ...chat.toObject(),
            otherParticipant: chat.participants.find(p => p._id.toString() !== currentUserId.toString()),
            unreadCount: 0
        };

        res.status(200).json(formattedChat);

    } catch (error) {
        console.error('Start Chat Error:', error);
        res.status(500).json({ error: 'Failed to start chat' });
    }
};

/**
 * Update message status (sent -> delivered -> read)
 */
exports.updateMessageStatus = async (req, res) => {
    const { messageId, status } = req.body;
    const currentUserId = req.userId;

    if (!messageId || !status) {
        return res.status(400).json({ error: 'Message ID and status are required' });
    }

    if (!['sent', 'delivered', 'read'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const message = await Message.findById(messageId).populate('senderId', '_id');

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Only recipient can update status
        // If sender is deleted (null), anyone can update or we treat as valid
        if (message.senderId && message.senderId._id.toString() === currentUserId.toString()) {
            return res.status(403).json({ error: 'Cannot update own message status' });
        }

        message.status = status;
        await message.save();

        // Notify sender
        getIO().to(message.senderId._id.toString()).emit('messageStatusUpdate', {
            messageId: message._id.toString(),
            status
        });

        res.status(200).json({ message: 'Status updated', status });
    } catch (error) {
        console.error('Update Message Status Error:', error);
        res.status(500).json({ error: 'Failed to update message status' });
    }
};

/**
 * Add reaction to a message
 */
exports.addReaction = async (req, res) => {
    const { messageId, emoji } = req.body;
    const currentUserId = req.userId;

    if (!messageId || !emoji) {
        return res.status(400).json({ error: 'Message ID and emoji are required' });
    }

    // Validate emoji (basic check)
    if (emoji.length > 10) {
        return res.status(400).json({ error: 'Invalid emoji' });
    }

    try {
        const message = await Message.findById(messageId).populate('senderId', '_id');

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Remove existing reaction from this user if exists
        message.reactions = message.reactions.filter(
            r => r.userId.toString() !== currentUserId.toString()
        );

        // Add new reaction
        message.reactions.push({ userId: currentUserId, emoji });
        await message.save();

        // Notify chat participants
        const chat = await Chat.findById(message.chatId);
        if (chat) {
            chat.participants.forEach(participantId => {
                getIO().to(participantId.toString()).emit('messageReaction', {
                    messageId: message._id.toString(),
                    userId: currentUserId.toString(),
                    emoji
                });
            });
        }

        res.status(200).json(message);
    } catch (error) {
        console.error('Add Reaction Error:', error);
        res.status(500).json({ error: 'Failed to add reaction' });
    }
};

/**
 * Remove reaction from a message
 */
exports.removeReaction = async (req, res) => {
    const { messageId } = req.body;
    const currentUserId = req.userId;

    if (!messageId) {
        return res.status(400).json({ error: 'Message ID is required' });
    }

    try {
        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        message.reactions = message.reactions.filter(
            r => r.userId.toString() !== currentUserId.toString()
        );
        await message.save();

        // Notify chat participants
        const chat = await Chat.findById(message.chatId);
        if (chat) {
            chat.participants.forEach(participantId => {
                getIO().to(participantId.toString()).emit('messageReactionRemoved', {
                    messageId: message._id.toString(),
                    userId: currentUserId.toString()
                });
            });
        }

        res.status(200).json(message);
    } catch (error) {
        console.error('Remove Reaction Error:', error);
        res.status(500).json({ error: 'Failed to remove reaction' });
    }
};

/**
 * Delete message (for me or for everyone)
 */
exports.deleteMessage = async (req, res) => {
    const { messageId, deleteForEveryone } = req.body;
    const currentUserId = req.userId;

    if (!messageId) {
        return res.status(400).json({ error: 'Message ID is required' });
    }

    try {
        const message = await Message.findById(messageId).populate('senderId', '_id');

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Check authorization
        const isSender = message.senderId && message.senderId._id.toString() === currentUserId.toString();
        if (!isSender && deleteForEveryone) {
            return res.status(403).json({ error: 'Only sender can delete for everyone' });
        }

        if (deleteForEveryone && isSender) {
            // Delete for everyone
            message.isDeleted = true;
            message.text = 'This message was deleted';
            message.media = null;
            await message.save();

            // Notify all participants
            const chat = await Chat.findById(message.chatId);
            if (chat) {
                chat.participants.forEach(participantId => {
                    getIO().to(participantId.toString()).emit('messageDeleted', {
                        messageId: message._id.toString(),
                        deleteForEveryone: true
                    });
                });
            }
        } else {
            // Delete for me only
            if (!message.deletedFor.includes(currentUserId)) {
                message.deletedFor.push(currentUserId);
                await message.save();
            }

            // Notify only current user
            getIO().to(currentUserId.toString()).emit('messageDeleted', {
                messageId: message._id.toString(),
                deleteForEveryone: false
            });
        }

        res.status(200).json({ message: 'Message deleted successfully' });
    } catch (error) {
        console.error('Delete Message Error:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
};

/**
 * Forward message to one or more recipients
 */
exports.forwardMessage = async (req, res) => {
    const { messageId, recipientIds } = req.body;
    const senderId = req.userId;

    if (!messageId || !recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
        return res.status(400).json({ error: 'Message ID and recipient IDs are required' });
    }

    try {
        const originalMessage = await Message.findById(messageId);

        if (!originalMessage) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const forwardedMessages = [];

        for (const recipientId of recipientIds) {
            // Validate recipient
            const recipient = await User.findById(recipientId);
            if (!recipient) continue;

            // Find or create chat
            let chat = await Chat.findOne({
                participants: { $all: [senderId, recipientId] }
            });

            if (!chat) {
                chat = await Chat.create({
                    participants: [senderId, recipientId],
                    unreadCount: new Map()
                });
            }

            // Create forwarded message
            const forwardedMessage = await Message.create({
                chatId: chat._id,
                senderId,
                text: originalMessage.text,
                type: originalMessage.type,
                media: originalMessage.media,
                forwardedFrom: originalMessage._id,
                status: 'sent'
            });

            await forwardedMessage.populate('senderId', 'name phoneNumber profilePicture');

            // Update chat
            chat.lastMessage = forwardedMessage._id;

            // Unhide chat if hidden
            if (chat.deletedBy && chat.deletedBy.length > 0) {
                chat.deletedBy = chat.deletedBy.filter(id =>
                    id.toString() !== senderId.toString() &&
                    id.toString() !== recipientId.toString()
                );
            }

            const currentUnread = chat.unreadCount.get(recipientId.toString()) || 0;
            chat.unreadCount.set(recipientId.toString(), currentUnread + 1);
            await chat.save();

            // Emit to recipient
            getIO().to(recipientId.toString()).emit('newMessage', forwardedMessage);

            forwardedMessages.push(forwardedMessage);
        }

        res.status(201).json({ messages: forwardedMessages });
    } catch (error) {
        console.error('Forward Message Error:', error);
        res.status(500).json({ error: 'Failed to forward message' });
    }
};

/**
 * Save or update contact name for a user
 */
exports.saveContactName = async (req, res) => {
    const { contactUserId, savedName } = req.body;
    const currentUserId = req.userId;

    if (!contactUserId || !savedName || !savedName.trim()) {
        return res.status(400).json({ error: 'Contact user ID and name are required' });
    }

    if (savedName.trim().length > 50) {
        return res.status(400).json({ error: 'Contact name must be 50 characters or less' });
    }

    try {
        // Verify contact user exists
        const contactUser = await User.findById(contactUserId);
        if (!contactUser) {
            return res.status(404).json({ error: 'Contact user not found' });
        }

        // Save or update contact name
        const contact = await Contact.findOneAndUpdate(
            { userId: currentUserId, contactUserId },
            { savedName: savedName.trim() },
            { upsert: true, new: true }
        );

        res.status(200).json({
            message: 'Contact name saved successfully',
            contact
        });
    } catch (error) {
        console.error('Save Contact Name Error:', error);
        res.status(500).json({ error: 'Failed to save contact name' });
    }
};

/**
 * Delete saved contact name
 */
exports.deleteContactName = async (req, res) => {
    const { contactUserId } = req.body;
    const currentUserId = req.userId;

    if (!contactUserId) {
        return res.status(400).json({ error: 'Contact user ID is required' });
    }

    try {
        const result = await Contact.findOneAndDelete({
            userId: currentUserId,
            contactUserId
        });

        if (!result) {
            return res.status(404).json({ error: 'Contact name not found' });
        }

        res.status(200).json({ message: 'Contact name deleted successfully' });
    } catch (error) {
        console.error('Delete Contact Name Error:', error);
        res.status(500).json({ error: 'Failed to delete contact name' });
    }
};

// ... (previous code)

/**
 * Toggle archive status of a chat
 */
exports.toggleArchiveChat = async (req, res) => {
    const { chatId } = req.body;
    const currentUserId = req.userId;

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) return res.status(404).json({ error: 'Chat not found' });

        const isArchived = chat.archivedBy && chat.archivedBy.includes(currentUserId);

        if (isArchived) {
            chat.archivedBy = chat.archivedBy.filter(id => id.toString() !== currentUserId.toString());
        } else {
            if (!chat.archivedBy) chat.archivedBy = [];
            chat.archivedBy.push(currentUserId);
        }

        await chat.save();
        res.status(200).json({ message: isArchived ? 'Chat unarchived' : 'Chat archived', archived: !isArchived });
    } catch (error) {
        console.error('Archive Chat Error:', error);
        res.status(500).json({ error: 'Failed to toggle archive' });
    }
};

/**
 * Delete chat (hide from list)
 */
exports.deleteChat = async (req, res) => {
    const { chatId } = req.body;
    const currentUserId = req.userId;

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) return res.status(404).json({ error: 'Chat not found' });

        if (!chat.deletedBy) chat.deletedBy = [];
        if (!chat.deletedBy.includes(currentUserId)) {
            chat.deletedBy.push(currentUserId);
            await chat.save();
        }

        res.status(200).json({ message: 'Chat deleted' });
    } catch (error) {
        console.error('Delete Chat Error:', error);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
};

/**
 * Clear chat history
 */
exports.clearChat = async (req, res) => {
    const { chatId } = req.body;
    const currentUserId = req.userId;

    try {
        // Mark all messages in this chat as deleted for this user
        await Message.updateMany(
            { chatId: chatId },
            { $addToSet: { deletedFor: currentUserId } }
        );

        res.status(200).json({ message: 'Chat cleared' });
    } catch (error) {
        console.error('Clear Chat Error:', error);
        res.status(500).json({ error: 'Failed to clear chat' });
    }
};

// Helper function to update message status
async function updateMessageStatus(messageId, status, senderId) {
    try {
        const message = await Message.findById(messageId);
        if (message && message.status !== status) {
            message.status = status;
            await message.save();

            if (message.senderId) {
                getIO().to(senderId.toString()).emit('messageStatusUpdate', {
                    messageId: message._id.toString(),
                    status
                });
            }
        }
    } catch (error) {
        console.error('Update Message Status Helper Error:', error);
    }
}
