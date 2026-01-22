const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../middleware/upload');

router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);

// Protected routes
router.get('/profile', authMiddleware, authController.getProfile);
router.get('/profile/:userId', authMiddleware, authController.getUserProfile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.post('/profile/picture', authMiddleware, upload.single('file'), authController.uploadProfilePicture);
router.delete('/profile/picture', authMiddleware, authController.removeProfilePicture);

module.exports = router;
