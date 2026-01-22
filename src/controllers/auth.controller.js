const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Contact = require('../models/Contact');
const { client, serviceSid } = require('../config/twilio');

exports.sendOtp = async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    // TEMPORARY: Bypass OTP sending for development
    // const BYPASS_OTP = process.env.BYPASS_OTP === 'true' || true; // Set to false to re-enable OTP
    const BYPASS_OTP = process.env.BYPASS_OTP === 'true';


    if (BYPASS_OTP) {
        console.log(`[DEV] OTP sending bypassed for ${phoneNumber}`);
        return res.status(200).json({
            status: 'approved',
            message: 'OTP bypassed (dev mode). Use any OTP like 000000 or 123456 to login.'
        });
    }

    try {
        const verification = await client.verify.v2
            .services(serviceSid)
            .verifications.create({ to: phoneNumber, channel: 'sms' });

        console.log(`[Twilio] OTP sent to ${phoneNumber}. Status: ${verification.status}`);

        res.status(200).json({ status: verification.status, message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Twilio Error:', error.message);
        // If bypass is enabled, still return success
        if (BYPASS_OTP) {
            return res.status(200).json({
                status: 'approved',
                message: 'OTP bypassed (dev mode)'
            });
        }
        res.status(500).json({ error: error.message || 'Failed to send OTP' });
    }
};

exports.verifyOtp = async (req, res) => {
    const { phoneNumber, otp, name } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    // TEMPORARY: Bypass OTP for development
    // Accept any OTP or skip OTP check entirely
    const BYPASS_OTP = process.env.BYPASS_OTP === 'true' || true; // Set to false to re-enable OTP
    // const BYPASS_CODE = '000000'; // Any OTP with this code will work

    try {
        let isVerified = false;

        if (BYPASS_OTP) {
            // Bypass OTP verification - accept any OTP or no OTP
            if (!otp || otp === BYPASS_CODE || otp === '123456') {
                console.log(`[DEV] OTP bypassed for ${phoneNumber}`);
                isVerified = true;
            } else {
                // Still try Twilio verification if OTP is provided
                try {
                    const verificationCheck = await client.verify.v2
                        .services(serviceSid)
                        .verificationChecks.create({ to: phoneNumber, code: otp });
                    isVerified = verificationCheck.status === 'approved';
                } catch (twilioError) {
                    // If Twilio fails but bypass is enabled, still allow
                    console.log(`[DEV] Twilio error, but bypass enabled: ${twilioError.message}`);
                    isVerified = true;
                }
            }
        } else {
            // Normal OTP verification
            if (!otp) {
                return res.status(400).json({ error: 'OTP is required' });
            }

            const verificationCheck = await client.verify.v2
                .services(serviceSid)
                .verificationChecks.create({ to: phoneNumber, code: otp });

            isVerified = verificationCheck.status === 'approved';
        }

        if (isVerified) {
            let user = await User.findOne({ phoneNumber });

            if (!user) {
                // Create new user - don't store name, only phone number
                user = await User.create({
                    phoneNumber,
                    name: '' // Users don't set their own name, others save them with custom names
                });
            }

            const token = jwt.sign(
                { userId: user._id },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.status(200).json({
                message: 'Login successful',
                token,
                user
            });
        } else {
            res.status(400).json({ error: 'Invalid OTP' });
        }
    } catch (error) {
        console.error('Verify OTP Error:', error);
        // If bypass is enabled, still allow login even on error
        if (BYPASS_OTP) {
            console.log(`[DEV] Error occurred but bypass enabled, allowing login`);
            try {
                let user = await User.findOne({ phoneNumber });

                if (!user) {
                    user = await User.create({
                        phoneNumber,
                        name: name || `User ${phoneNumber.slice(-4)}`
                    });
                }

                const token = jwt.sign(
                    { userId: user._id },
                    process.env.JWT_SECRET,
                    { expiresIn: '7d' }
                );

                return res.status(200).json({
                    message: 'Login successful (bypassed)',
                    token,
                    user
                });
            } catch (userError) {
                return res.status(500).json({ error: userError.message || 'Failed to create/login user' });
            }
        }
        res.status(500).json({ error: error.message || 'Failed to verify OTP' });
    }
};

/**
 * Update user profile
 */
exports.updateProfile = async (req, res) => {
    const userId = req.userId;
    const { name, profilePicture, about, privacySettings, theme } = req.body;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Validate name
        if (name !== undefined) {
            if (typeof name !== 'string' || name.length > 50) {
                return res.status(400).json({ error: 'Name must be a string with max 50 characters' });
            }
            user.name = name.trim();
        }

        // Update about/status
        if (about !== undefined) {
            if (typeof about !== 'string' || about.length > 139) {
                return res.status(400).json({ error: 'About must be a string with max 139 characters' });
            }
            user.about = about.trim();
        }

        // Update profile picture
        if (profilePicture !== undefined) {
            user.profilePicture = profilePicture;
        }

        // Update theme
        if (theme !== undefined) {
            user.theme = theme;
        }

        // Update privacy settings
        if (privacySettings) {
            if (privacySettings.readReceipts !== undefined) {
                user.privacySettings.readReceipts = Boolean(privacySettings.readReceipts);
            }
            if (privacySettings.lastSeenVisibility) {
                if (!['everyone', 'contacts', 'nobody'].includes(privacySettings.lastSeenVisibility)) {
                    return res.status(400).json({ error: 'Invalid last seen visibility setting' });
                }
                user.privacySettings.lastSeenVisibility = privacySettings.lastSeenVisibility;
            }
        }

        await user.save();

        // Emit profile update to all connected clients
        const { getIO } = require('../socket/socket');
        try {
            getIO().emit('profileUpdated', {
                userId: user._id.toString(),
                profilePicture: user.profilePicture,
                about: user.about,
                name: user.name
            });
        } catch (socketError) {
            console.error('Socket emission error:', socketError);
        }

        res.status(200).json({
            message: 'Profile updated successfully',
            user
        });
    } catch (error) {
        console.error('Update Profile Error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
};

/**
 * Upload profile picture
 */
exports.uploadProfilePicture = async (req, res) => {
    const userId = req.userId;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update profile picture URL
        const fileUrl = `/uploads/profile/${req.file.filename}`;
        user.profilePicture = fileUrl;
        await user.save();

        // Emit profile update to all connected clients
        const { getIO } = require('../socket/socket');
        try {
            getIO().emit('profileUpdated', {
                userId: user._id.toString(),
                profilePicture: user.profilePicture,
                about: user.about,
                name: user.name
            });
        } catch (socketError) {
            console.error('Socket emission error:', socketError);
        }

        res.status(200).json({
            message: 'Profile picture uploaded successfully',
            profilePicture: fileUrl,
            user
        });
    } catch (error) {
        console.error('Upload Profile Picture Error:', error);
        res.status(500).json({ error: 'Failed to upload profile picture' });
    }
};

/**
 * Remove profile picture
 */
exports.removeProfilePicture = async (req, res) => {
    const userId = req.userId;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.profilePicture = null;
        await user.save();

        // Emit profile update to all connected clients
        const { getIO } = require('../socket/socket');
        try {
            getIO().emit('profileUpdated', {
                userId: user._id.toString(),
                profilePicture: null,
                about: user.about,
                name: user.name
            });
        } catch (socketError) {
            console.error('Socket emission error:', socketError);
        }

        res.status(200).json({
            message: 'Profile picture removed successfully',
            user
        });
    } catch (error) {
        console.error('Remove Profile Picture Error:', error);
        res.status(500).json({ error: 'Failed to remove profile picture' });
    }
};

/**
 * Get current user profile
 */
exports.getProfile = async (req, res) => {
    const userId = req.userId;

    try {
        const user = await User.findById(userId)
            .select('name phoneNumber profilePicture about lastSeen isOnline privacySettings theme createdAt');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json(user);
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
};

/**
 * Get user profile by ID (for viewing other users' profiles)
 */
exports.getUserProfile = async (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.userId;

    try {
        const user = await User.findById(userId)
            .select('phoneNumber profilePicture about lastSeen isOnline privacySettings');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check privacy settings for last seen
        let lastSeen = null;
        if (user.privacySettings.lastSeenVisibility === 'everyone') {
            lastSeen = user.lastSeen;
        } else if (user.privacySettings.lastSeenVisibility === 'contacts') {
            // Check if users have a chat together
            const Chat = require('../models/Chat');
            const chat = await Chat.findOne({
                participants: { $all: [currentUserId, userId] }
            });
            if (chat) {
                lastSeen = user.lastSeen;
            }
        }

        res.status(200).json({
            ...user.toObject(),
            lastSeen: lastSeen
        });
    } catch (error) {
        console.error('Get User Profile Error:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
};