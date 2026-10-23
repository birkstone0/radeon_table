// MongoDB connection and models for TablePH VIP Console
const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../lib/logger');

let connection = null;
let connectionPromise = null;

async function connect() {
    if (connection) return connection;

    if (!config.mongodbUri) {
        throw new Error('MONGODB_URI is required in environment variables');
    }

    try {
        connection = await mongoose.connect(config.mongodbUri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        logger.info('DB', 'MongoDB connected');
        return connection;
    } catch (error) {
        logger.error('DB', `MongoDB connection failed: ${error.message}`);
        throw error;
    }
}

async function disconnect() {
    if (connection) {
        await mongoose.disconnect();
        connection = null;
        connectionPromise = null;
    }
}

function getConnection() {
    if (!connectionPromise) {
        connectionPromise = connect();
    }
    return connectionPromise.then(() => mongoose.connection.asPromise());
}

function isConnected() {
    return mongoose.connection.readyState === 1;
}

module.exports = {
    connect,
    disconnect,
    getConnection,
    isConnected,
    mongoose
};
