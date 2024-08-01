const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = 3000;
const UPLOAD_DIR = './uploads';
const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB

// Multer storage configuration
const storage = multer.memoryStorage();
const upload = multer({ storage: storage }).single('myFile');

// Create upload directory if not exists
fs.ensureDirSync(UPLOAD_DIR);

// WebSocket server for progress updates
const wss = new WebSocketServer({ port: 8080 });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/files', async (req, res) => {
    try {
        const files = await fs.readdir(UPLOAD_DIR);
        res.status(200).json(files);
    } catch (error) {
        res.status(500).json({ message: 'Failed to read files', error: error.message });
    }
});

app.post('/upload', (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ message: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded!' });
        }

        const buffer = req.file.buffer;
        const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);
        const fileName = req.file.originalname;
        const fileBaseName = path.parse(fileName).name;
        const fileExt = path.parse(fileName).ext;

        try {
            // Save chunks
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, buffer.length);
                const chunk = buffer.slice(start, end);
                const chunkFileName = `${fileBaseName}-chunk-${i + 1}${fileExt}`;
                const chunkFilePath = path.join(UPLOAD_DIR, chunkFileName);

                await fs.writeFile(chunkFilePath, chunk);

                // Notify WebSocket clients about the progress
                const progress = Math.round(((i + 1) / totalChunks) * 100);
                wss.clients.forEach(client => {
                    if (client.readyState === client.OPEN) {
                        client.send(JSON.stringify({ progress }));
                    }
                });
            }

            // Merge chunks
            const chunkFiles = await fs.readdir(UPLOAD_DIR);
            const sortedChunkFiles = chunkFiles
                .filter(file => file.startsWith(fileBaseName) && file.endsWith(fileExt))
                .sort((a, b) => {
                    const aIndex = parseInt(a.split('-chunk-')[1], 10);
                    const bIndex = parseInt(b.split('-chunk-')[1], 10);
                    return aIndex - bIndex;
                });

            const mergedFilePath = path.join(UPLOAD_DIR, fileName);
            const writeStream = fs.createWriteStream(mergedFilePath);

            for (const chunkFile of sortedChunkFiles) {
                const chunkFilePath = path.join(UPLOAD_DIR, chunkFile);
                const chunkStream = fs.createReadStream(chunkFilePath);
                await new Promise((resolve, reject) => {
                    chunkStream.pipe(writeStream, { end: false });
                    chunkStream.on('end', resolve);
                    chunkStream.on('error', reject);
                });
            }

            writeStream.end();

            // Remove chunks
            for (const chunkFile of sortedChunkFiles) {
                const chunkFilePath = path.join(UPLOAD_DIR, chunkFile);
                await fs.remove(chunkFilePath);
            }

            res.status(200).json({ message: 'File uploaded, chunked, and merged successfully!' });
        } catch (error) {
            res.status(500).json({ message: 'Failed to process file', error: error.message });
        }
    });
});

// Download endpoint
app.get('/download/:filename', async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOAD_DIR, filename);

    try {
        res.download(filePath, (err) => {
            if (err) {
                res.status(500).json({ message: 'Failed to download file', error: err.message });
            } else {
                fs.remove(filePath); // Remove file after download
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to download file', error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});
