const express = require('express');
const { Client, LocalAuth, MessageMedia} = require('whatsapp-web.js');
const multer = require('multer');
const  MysqlStore  = require('./mysqlstore');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
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
    connectionLimit: 10,  // max number of concurrent conections
    queueLimit: 0         // max number of conections on queue (0 = limitless)
});

const tableInfo = {
    table: 'wsp_sessions',
    session_column: 'session_name',
    data_column: 'data',
    updated_at_column: 'updated_at'
}



// Parse application/json
app.use(bodyParser.json());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname); // Get original extension
        cb(null, uniqueSuffix + extension); // Save with extension
    }
});
const upload = multer({ storage });
 const store = new MysqlStore({ pool: pool, tableInfo: tableInfo });



 //CREATE TABLE `wsp_sessions` (
//   `id` bigint unsigned NOT NULL AUTO_INCREMENT,
//   `session_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
//   `data` mediumblob,
//   `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
//   `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
//   PRIMARY KEY (`id`),
//   UNIQUE KEY `wsp_sessions_session_name_unique` (`session_name`)
// ) 

// Initialize the WhatsApp client with session management
const client2 = new Client({
    authStrategy: new LocalAuth({
        clientId: "client-one" })
});

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "client-two" })
});
// const client = new Client({
//     authStrategy: new LocalAuth()
// });



let qrCodeImage = ''; // Holds the QR code image data

// Handle QR code generation for client authentication
client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeImage = url;
    });
    console.log('Please scan the QR code displayed on the web page.');
});

client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    qrCodeImage = ''; // Clear QR code after successful login
});

// Log any authentication failure
client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
});

// Catch other errors
client.on('error', (error) => {
    console.error('An error occurred:', error);
});



// Serve the main page with QR code or message interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint to check if client is ready and return QR code if not
app.get('/status', (req, res) => {
    if (qrCodeImage) {
        res.json({ qr: qrCodeImage, ready: false });
    } else {
        res.json({ ready: true });
    }
});


// API endpoint to send a text message
app.post('/send', (req, res) => {
    const { number, message } = req.body;
    const chatId = `${number}@c.us`;

    client.sendMessage(chatId, message)
        .then(response => res.json({ success: true, response }))
        .catch(error => res.status(500).json({ success: false, error }));
});

app.post('/send-media', upload.single('media'), async (req, res) => {
    try {
        const number = req.body.number;
        const caption = req.body.caption;
        const filePath = req.file.path;

        console.log(filePath);
        // Correctly read the file and convert it to base64
        const media = MessageMedia.fromFilePath(filePath);
        const chatId = `${number}@c.us`;

        // Send the media message with the correct caption
        await client.sendMessage(chatId, media, { caption });

        // Remove the file after sending
        fs.unlinkSync(filePath);

        res.status(200).json({ message: 'Media sent successfully' });
    } catch (error) {
        console.error('Error sending media:', error);
        res.status(500).json({ error: 'Failed to send media' });
    }
});

// API endpoint to send a text message using GET request
app.get('/send', (req, res) => {
    const { number, message } = req.query;
    const chatId = `${number}@c.us`;
    console.log(req.query);

    if (!number || !message) {
        return res.status(400).json(fail);
    }

    client.sendMessage(chatId, message)
        .then(response => res.send("success"))
        .catch(error => res.status(500).send("fail"));
});

// API endpoint to send media using GET request
app.get('/send-media', (req, res) => {
    const { number, mediaPath, caption } = req.query;
    const chatId = `${number}@c.us`;
    console.log(req.query);

    if (!number || !mediaPath) {
        return res.status(400).json({ success: false, error: "Missing 'number' or 'mediaPath' query parameter" });
    }

    // Validate if the file exists
    if (!fs.existsSync(mediaPath)) {
        return res.status(404).json({ success: false, error: 'Media file not found' });
    }

    const media = MessageMedia.fromFilePath(mediaPath);

    client.sendMessage(chatId, media, { caption })
        .then(response => res.json({ success: true, response }))
        .catch(error => res.status(500).json({ success: false, error }));
});


// Initialize the client
client.initialize();



// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
