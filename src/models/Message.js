const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    emoji: {
        type: String,
        required: true,
        maxlength: 10
    }
}, { _id: false, timestamps: true });

const messageSchema = new mongoose.Schema({
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat',
        required: true,
        index: true
    },
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    text: {
        type: String,
        default: '',
        trim: true,
        maxlength: 4096
    },
    type: {
        type: String,
        enum: ['text', 'image', 'audio', 'video', 'emoji'],
        default: 'text'
    },
    media: {
        url: {
            type: String,
            default: null
        },
        mimeType: {
            type: String,
            default: null
        },
        size: {
            type: Number,
            default: null
        },
        thumbnail: {
            type: String,
            default: null
        },
        duration: {
            type: Number,
            default: null // For audio/video in seconds
        }
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent',
        index: true
    },
    reactions: [reactionSchema],
    deletedFor: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    isDeleted: {
        type: Boolean,
        default: false
    },
    forwardedFrom: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null
    }
}, { timestamps: true });

// Indexes for performance
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ status: 1 });

// Validation: text or media must be present
messageSchema.pre('validate', function(next) {
    if (!this.text && !this.media?.url) {
        return next(new Error('Message must have either text or media'));
    }
    next();
});

module.exports = mongoose.model('Message', messageSchema);
