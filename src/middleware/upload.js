const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const type = req.body.type || req.body.fileType || 'media';
        const dir = path.join(uploadsDir, type === 'profile' ? 'profile' : 'media');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    const allowedTypes = {
        image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
        video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
        audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/webm'],
        profile: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
        media: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/webm']
    };

    const type = req.body.type || req.body.fileType || 'media';
    const allowed = allowedTypes[type] || allowedTypes.media;

    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid file type. Allowed: ${allowed.join(', ')}`), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max
    }
});

module.exports = upload;

