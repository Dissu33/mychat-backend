const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../middleware/upload');

router.use(authMiddleware);

// Message routes
router.post('/send', chatController.sendMessage);
router.post('/upload-media', upload.single('file'), chatController.uploadMedia);
router.post('/forward', chatController.forwardMessage);
router.put('/status', chatController.updateMessageStatus);
router.post('/message/delete', chatController.deleteMessage); // Use POST for delete with body

// Reaction routes
router.post('/reaction', chatController.addReaction);
router.delete('/reaction', chatController.removeReaction);

// Contact routes
router.post('/contact/save', chatController.saveContactName);
router.post('/contact/delete', chatController.deleteContactName);

// Chat routes
// Chat Actions
router.post('/archive', chatController.toggleArchiveChat);
router.post('/delete', chatController.deleteChat);
router.post('/clear', chatController.clearChat);

router.post('/search', chatController.searchUserByPhone);
router.post('/start', chatController.startChat);
router.get('/:userId', chatController.getChatHistory);
router.get('/', chatController.getChats);

module.exports = router;
