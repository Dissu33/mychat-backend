/**
 * File upload validation middleware
 * Validates file type, size, and other constraints
 */

// File size limits (in bytes)
const MAX_FILE_SIZES = {
    image: 10 * 1024 * 1024, // 10MB
    audio: 16 * 1024 * 1024, // 16MB
    video: 50 * 1024 * 1024, // 50MB
    default: 10 * 1024 * 1024 // 10MB default
};

// Allowed MIME types
const ALLOWED_MIME_TYPES = {
    image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/webm'],
    video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
};

/**
 * Validate file upload
 * @param {string} type - Message type (image, audio, video)
 * @param {object} file - File object with mimetype and size
 * @returns {object} - { valid: boolean, error?: string }
 */
const validateFile = (type, file) => {
    if (!file) {
        return { valid: false, error: 'No file provided' };
    }

    // Check file type
    const allowedTypes = ALLOWED_MIME_TYPES[type] || [];
    if (!allowedTypes.includes(file.mimetype)) {
        return {
            valid: false,
            error: `Invalid file type. Allowed types for ${type}: ${allowedTypes.join(', ')}`
        };
    }

    // Check file size
    const maxSize = MAX_FILE_SIZES[type] || MAX_FILE_SIZES.default;
    if (file.size > maxSize) {
        const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
        return {
            valid: false,
            error: `File size exceeds maximum allowed size of ${maxSizeMB}MB`
        };
    }

    return { valid: true };
};

/**
 * Sanitize message text input
 * @param {string} text - Message text
 * @returns {string} - Sanitized text
 */
const sanitizeText = (text) => {
    if (!text || typeof text !== 'string') return '';
    
    // Remove potentially dangerous characters but keep emojis and normal text
    return text
        .trim()
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
        .slice(0, 4096); // Max length
};

/**
 * Validate message input
 * @param {object} messageData - Message data to validate
 * @returns {object} - { valid: boolean, error?: string }
 */
const validateMessage = (messageData) => {
    const { type, text, media } = messageData;

    // Type validation
    if (!type || !['text', 'image', 'audio', 'video', 'emoji'].includes(type)) {
        return { valid: false, error: 'Invalid message type' };
    }

    // Text messages must have text
    if (type === 'text' && (!text || !text.trim())) {
        return { valid: false, error: 'Text is required for text messages' };
    }

    // Media messages must have media
    if (['image', 'audio', 'video'].includes(type)) {
        if (!media || !media.url) {
            return { valid: false, error: 'Media URL is required for media messages' };
        }
        if (!media.mimeType) {
            return { valid: false, error: 'Media MIME type is required' };
        }
    }

    // Validate text length
    if (text && text.length > 4096) {
        return { valid: false, error: 'Message text exceeds maximum length of 4096 characters' };
    }

    return { valid: true };
};

module.exports = {
    validateFile,
    sanitizeText,
    validateMessage,
    MAX_FILE_SIZES,
    ALLOWED_MIME_TYPES
};

