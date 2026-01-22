const mongoose = require('mongoose');

/**
 * Contact model - stores custom names users save for other users
 * Similar to WhatsApp's contact name feature
 */
const contactSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    contactUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    savedName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    }
}, { timestamps: true });

// Ensure one saved name per user-contact pair
contactSchema.index({ userId: 1, contactUserId: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);

