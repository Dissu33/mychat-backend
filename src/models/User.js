const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        default: '',
        trim: true,
        maxlength: 50
    },
    profilePicture: {
        type: String,
        default: null
    },
    about: {
        type: String,
        default: '',
        trim: true,
        maxlength: 139 // WhatsApp limit
    },
    lastSeen: {
        type: Date,
        default: Date.now
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    privacySettings: {
        readReceipts: {
            type: Boolean,
            default: true
        },
        lastSeenVisibility: {
            type: String,
            enum: ['everyone', 'contacts', 'nobody'],
            default: 'everyone'
        }
    },
    theme: {
        type: String,
        enum: ['light', 'dark', 'auto'],
        default: 'dark'
    }
}, { timestamps: true });

// Index for faster queries
userSchema.index({ phoneNumber: 1 });
userSchema.index({ lastSeen: -1 });

module.exports = mongoose.model('User', userSchema);
