const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = 3000;
const UPLOAD_DIR = './uploads';
const CHUNK_SIZE = 25 * 1024 * 1024; // 25MB

// Multer storage configuration
const storage = multer.memoryStorage(); // Store file in memory

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit per file
}).single('myFile');

// Create upload directory if not exists
fs.ensureDirSync(UPLOAD_DIR);

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to list files in the upload directory
app.get('/files', async (req, res) => {
    try {
        const files = await fs.readdir(UPLOAD_DIR);
        res.status(200).json(files);
    } catch (error) {
        res.status(500).json({ message: 'Failed to read files', error: error.message });
    }
});

// Upload endpoint
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
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, buffer.length);
                const chunk = buffer.slice(start, end);
                const chunkFileName = `${fileBaseName}-chunk-${i + 1}${fileExt}`;
                const chunkFilePath = path.join(UPLOAD_DIR, chunkFileName);

                await fs.writeFile(chunkFilePath, chunk);
            }

            res.status(200).json({ message: 'File uploaded and chunked successfully!' });
        } catch (error) {
            res.status(500).json({ message: 'Failed to process file', error: error.message });
        }
    });
});

// Download endpoint
app.get('/download/:filename', async (req, res) => {
    const filename = req.params.filename;
    const fileBaseName = path.parse(filename).name;
    const fileExt = path.parse(filename).ext;
    const files = await fs.readdir(UPLOAD_DIR);
    const chunkFiles = files.filter(file => file.startsWith(fileBaseName) && file.endsWith(fileExt));
    const sortedChunkFiles = chunkFiles.sort((a, b) => {
        const aIndex = parseInt(a.split('-chunk-')[1], 10);
        const bIndex = parseInt(b.split('-chunk-')[1], 10);
        return aIndex - bIndex;
    });

    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/octet-stream');

    for (const chunkFile of sortedChunkFiles) {
        const chunkFilePath = path.join(UPLOAD_DIR, chunkFile);
        const chunkStream = fs.createReadStream(chunkFilePath);
        await new Promise((resolve, reject) => {
            chunkStream.pipe(res, { end: false });
            chunkStream.on('end', resolve);
            chunkStream.on('error', reject);
        });
    }

    res.end();
});

app.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});
