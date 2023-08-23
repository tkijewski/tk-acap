import { exec,execSync } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

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
        
        execSync(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing FFmpeg: ${stderr}`);
                reject(error);
            }
            
            console.log(`File converted successfully`);

            fs.unlinkSync(inputPath, (err) => {
                if (err) {
                    console.error('Error deleting the file:', err);
                    return;
                }
                console.log('File deleted successfully');
            });
        });
        resolve();
    });
}

export async function addSilenceBeep(inputPath, silenceSeconds=10, beepPosition) {
    return new Promise((resolve, reject) => {
        var remainingSilence = silenceSeconds - beepPosition;

        const silenceCommand = `
            ffmpeg -f lavfi -y -t ${beepPosition} -i anullsrc=r=44100:cl=stereo tmp/pre_beep_silence.wav && 
            ffmpeg -f lavfi -y -t ${remainingSilence} -i anullsrc=r=44100:cl=stereo tmp/post_beep_silence.wav && 
            ffmpeg -f lavfi -y -t 1 -i sine=frequency=1000:sample_rate=44100 tmp/beep.wav && 
            ffmpeg -i tmp/pre_beep_silence.wav -i tmp/beep.wav -i tmp/post_beep_silence.wav -i ${inputPath} -filter_complex "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[out]" -y -map "[out]" silence.wav
            `;

        const deleteOldWavCommand = `rm ${inputPath}`;
        const renameGenCommand = `mv silence.wav ` + path.basename(inputPath);

            

        execSync(silenceCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`silenceCommand error: ${error}`);
                reject(error);
            }
            console.error(`Error output (if any): ${stderr}`);
        });

        execSync(deleteOldWavCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`deleteOldWavCommand error: ${error}`);
                reject(error);
            }
            console.error(`Error output (if any): ${stderr}`);
        });

        execSync(renameGenCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                reject(error);
            }
            console.error(`Error output (if any): ${stderr}`);
        });

        console.log('Beep Position: '+beepPosition);

        resolve(beepPosition);
    });
}