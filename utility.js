import { exec } from 'child_process';
import axios from 'axios';
import fs from 'fs';

export function downloadFile(url, outputPath) {
    return axios({
        url,
        responseType: 'stream',
    }).then(response => {
        return new Promise((resolve, reject) => {
            const stream = response.data.pipe(fs.createWriteStream(outputPath));
            stream.on('finish', resolve);
            stream.on('error', reject);
        });
    });
}

export function convertWavToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const command = `ffmpeg -i ${inputPath} ${outputPath}`;
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing FFmpeg: ${stderr}`);
                reject(error);
                return;
            }
            
            console.log(`File converted successfully: ${stdout}`);

            fs.unlink(inputPath, (err) => {
                if (err) {
                    console.error('Error deleting the file:', err);
                    return;
                }
                console.log('File deleted successfully');
            });
            resolve();
        });
    });
}