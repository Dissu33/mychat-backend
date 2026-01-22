/**
 * Format timestamp similar to WhatsApp
 * @param {Date} date - The date to format
 * @returns {string} - Formatted timestamp string
 */
exports.formatTimestamp = (date) => {
    if (!date) return '';
    
    const now = new Date();
    const messageDate = new Date(date);
    const diffInMs = now - messageDate;
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    // Today - show only time
    if (diffInDays === 0) {
        return messageDate.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    // Yesterday
    if (diffInDays === 1) {
        return 'Yesterday';
    }
    
    // This week - show day name
    if (diffInDays < 7) {
        return messageDate.toLocaleDateString([], { weekday: 'short' });
    }
    
    // This year - show date without year
    if (messageDate.getFullYear() === now.getFullYear()) {
        return messageDate.toLocaleDateString([], { 
            month: 'short', 
            day: 'numeric' 
        });
    }
    
    // Older - show full date
    return messageDate.toLocaleDateString([], { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    });
};

/**
 * Format last seen timestamp
 * @param {Date} date - The last seen date
 * @returns {string} - Formatted last seen string
 */
exports.formatLastSeen = (date) => {
    if (!date) return 'Never';
    
    const now = new Date();
    const lastSeen = new Date(date);
    const diffInMs = now - lastSeen;
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    if (diffInMinutes < 1) {
        return 'Just now';
    }
    
    if (diffInMinutes < 60) {
        return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    }
    
    if (diffInHours < 24) {
        return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    }
    
    if (diffInDays === 1) {
        return 'Yesterday';
    }
    
    if (diffInDays < 7) {
        return `${diffInDays} days ago`;
    }
    
    return lastSeen.toLocaleDateString([], { 
        month: 'short', 
        day: 'numeric',
        year: lastSeen.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
};

