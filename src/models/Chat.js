const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }],
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    unreadCount: {
        type: Map,
        of: Number,
        default: {}
    }
}, { timestamps: true });

// Index for faster participant queries
chatSchema.index({ participants: 1 });
chatSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Chat', chatSchema);
