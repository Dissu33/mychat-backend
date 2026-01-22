const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { initSocket } = require('./socket/socket');
const dotenv = require('dotenv');

dotenv.config();

// Connect Database
const startServer = async () => {
    // Connect Database
    await connectDB();

    const server = http.createServer(app);

    // Init Socket.io
    initSocket(server);

    const PORT = process.env.PORT || 5000;

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer();
