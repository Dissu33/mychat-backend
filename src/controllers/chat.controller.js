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
            msg => msg.senderId._id.toString() !== currentUserId.toString() && 
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
            participants: { $in: [currentUserId] }
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
                p => p._id.toString() !== currentUserId.toString()
            );
            const unreadCount = chat.unreadCount.get(currentUserId.toString()) || 0;
            
            // Add saved name if exists
            const savedName = contactMap[otherParticipant?._id.toString()] || null;
            const displayName = savedName || otherParticipant?.phoneNumber;

            return {
                ...chat.toObject(),
                otherParticipant: otherParticipant ? {
                    ...otherParticipant.toObject(),
                    savedName,
                    displayName
                } : null,
                unreadCount
            };
        });

        res.status(200).json(formattedChats);
    } catch (error) {
        console.error('Get Chats Error:', error);
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
};

/**
 * Get all users (contacts) with online status and saved contact names
 */
exports.getUsers = async (req, res) => {
    try {
        const currentUserId = req.userId;
        const users = await User.find({ _id: { $ne: currentUserId } })
            .select('phoneNumber _id profilePicture about isOnline lastSeen privacySettings')
            .sort({ phoneNumber: 1 });

        // Get saved contact names for current user
        const contacts = await Contact.find({ userId: currentUserId });
        const contactMap = {};
        contacts.forEach(contact => {
            contactMap[contact.contactUserId.toString()] = contact.savedName;
        });

        // Add saved names to users
        const usersWithContacts = users.map(user => ({
            ...user.toObject(),
            savedName: contactMap[user._id.toString()] || null,
            displayName: contactMap[user._id.toString()] || user.phoneNumber
        }));

        res.status(200).json(usersWithContacts);
    } catch (error) {
        console.error('Get Users Error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
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
        if (message.senderId._id.toString() === currentUserId.toString()) {
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
        const isSender = message.senderId._id.toString() === currentUserId.toString();
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

// Helper function to update message status
async function updateMessageStatus(messageId, status, senderId) {
    try {
        const message = await Message.findById(messageId);
        if (message && message.status !== status) {
            message.status = status;
            await message.save();
            
            getIO().to(senderId.toString()).emit('messageStatusUpdate', {
                messageId: message._id.toString(),
                status
            });
        }
    } catch (error) {
        console.error('Update Message Status Helper Error:', error);
    }
}
