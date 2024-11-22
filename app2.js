const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const multer = require('multer');
const MysqlStore = require('./mysqlstore');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');

const app = express();
const port = 4500;

const pool = mysql.createPool({
    host: process.env.DB_MYSQL_HOST,
    user: process.env.DB_MYSQL_USER,
    password: process.env.DB_MYSQL_PASSWORD,
    database: process.env.DB_MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const tableInfo = {
    table: 'wsp_sessions',
    session_column: 'session_name',
    data_column: 'data',
    updated_at_column: 'updated_at'
};

// Middleware
app.use(bodyParser.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, uniqueSuffix + extension);
    }
});

const upload = multer({ storage });

const store = new MysqlStore({ pool: pool, tableInfo: tableInfo });

// Array to hold multiple clients
const clients = [];

// Function to initialize a new WhatsApp client
function createClient(id) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
    });

    client.on('qr', (qr) => {
        qrcode.toDataURL(qr, (err, url) => {
            console.log(`QR code for client ${id}: ${qr}`);
        });
        console.log(`Client ${id}: Please scan the QR code.`);
    });

    client.on('ready', () => {
        console.log(`Client ${id} is ready!`);
    });

    client.on('auth_failure', (msg) => {
        console.error(`Client ${id} authentication failed:`, msg);
    });

    client.on('error', (error) => {
        console.error(`Client ${id} encountered an error:`, error);
    });

    client.initialize();
    clients.push({ id, client });
}

// // Initialize multiple clients
// createClient("client-one");
// createClient("client-two");

// Helper function to find client by ID
function getClient(id) {
    return clients.find(client => client.id === id)?.client;
}
// Helper function to find client status by ID
function getClientStatus(id) {
    return clients.find(client => client.id === id)?.status;
}



let qrCodes = {}; // Store QR codes by clientId
let clientStatuses = {}; // Store statuses by clientId

function createClient(id) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
    });

    client.on('qr', (qr) => {
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error(`Error generating QR code for client ${id}:`, err);
                return;
            }
            qrCodes[id] = url; // Store the QR code
            console.log(`QR code for client ${id} generated.`);
        });
    });

    client.on('ready', () => {
        clientStatuses[id] = 'ready';
        console.log(`Client ${id} is ready!`);
    });

    client.on('auth_failure', (msg) => {
        clientStatuses[id] = 'auth_failure';
        console.error(`Client ${id} authentication failed:`, msg);
    });

    client.on('error', (error) => {
        clientStatuses[id] = 'error';
        console.error(`Client ${id} encountered an error:`, error);
    });

    client.initialize();
    clients.push({ id, client });
    clientStatuses[id] = 'initializing'; // Initial status
}



app.get('/initialise', async (req, res) => {
    
    function generateClientId(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    const id = `abcd-${generateClientId(8)}`;
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
    });


 client.on('qr',async (qr) => {
     qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error(`Error generating QR code for client ${id}:`, err);
                return;
            }
            console.log(url);
            qrCodes[id] = url; // Store the QR code
            clientStatuses[id] = 'qr';
            console.log(`QR code for client ${id} generated.`);
        });
    });

     client.on('ready', () => {
        clientStatuses[id] = 'ready';
        console.log(`Client ${id} is ready!`);
    });

    client.on('auth_failure', (msg) => {
        clientStatuses[id] = 'auth_failure';
        console.error(`Client ${id} authentication failed:`, msg);
    });

    client.on('error', (error) => {
        clientStatuses[id] = 'error';
        console.error(`Client ${id} encountered an error:`, error);
    });

   client.initialize();
    clients.push({ id, client });
   // clientStatuses[id] = 'initializing'; 
    res.json(id);
});

app.get('/getqr/:clientId', (req, res) => {
    const { clientId } = req.params;
    const qr = qrCodes[clientId];
    const status = clientStatuses[clientId] || 'unknown';
    console.log(qr);
    console.log(status);

    if (!qr && status === 'initializing') {
        return res.status(202).send({ message: 'Client is initializing, please wait for the QR code.' });
    }

    if (!qr && status === 'ready') {
        return res.status(404).send({ message: 'No QR code available; client is already authenticated.' });
    }

    if (!qr) {
        return res.status(404).send({ message: 'Client not found or no QR code available.' });
    }

    res.send({ id: clientId, qr, status });
});


// Route to send text message with specified client
app.post('/send/:clientId', (req, res) => {
    const { clientId } = req.params;
    const { number, message } = req.body;
    const client = getClient(clientId);

    if (!client) {
        return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const chatId = `${number}@c.us`;
    client.sendMessage(chatId, message)
        .then(response => res.json({ success: true, response }))
        .catch(error => res.status(500).json({ success: false, error }));
});

// Route to send media message with specified client
app.post('/send-media/:clientId', upload.single('media'), async (req, res) => {
    const { clientId } = req.params;
    const { number, caption } = req.body;
    const client = getClient(clientId);

    if (!client) {
        return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const chatId = `${number}@c.us`;
    const media = MessageMedia.fromFilePath(req.file.path);

    try {
        await client.sendMessage(chatId, media, { caption });
        fs.unlinkSync(req.file.path);
        res.status(200).json({ success: true, message: 'Media sent successfully' });
    } catch (error) {
        console.error(`Error sending media for client ${clientId}:`, error);
        res.status(500).json({ success: false, error: 'Failed to send media' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
