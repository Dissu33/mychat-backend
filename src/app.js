const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth.routes');
const chatRoutes = require('./routes/chat.routes');

const app = express();

// Middleware
app.use(cors({
    origin: true, // Reflects the request origin
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/auth', authRoutes);
app.use('/chat', chatRoutes);

app.get('/', (req, res) => {
    res.send('WhatsApp Clone Backend is running');
});

module.exports = app;
