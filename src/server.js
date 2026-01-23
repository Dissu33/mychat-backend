"use strict";

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { initSocket } = require('./socket/socket');
const dotenv = require('dotenv');
// hi
dotenv.config();

// Connect Database
const startServer = async () => {
    try {
        // Connect Database
        await connectDB();

        const server = http.createServer(app);

        // Init Socket.io
        initSocket(server);

        // Railway uses the PORT environment variable to route traffic.
        // It defaults to 8080 if not specified by us, but Railway sets it automatically.
        // We must listen on THIS variable, not just force 5000.
        // If Railway says "Port 8080" in dashboard, it means it's routing traffic to our container's internal port.
        // Our app must listen on process.env.PORT (which Railway sets to something like 3000, 4000, 5000 etc. or 8080 depending on detection)
        // OR we must tell Railway to listen on 5000.
        // Best Practice: Always trust process.env.PORT
        const PORT = process.env.PORT || 5000;

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

startServer();
