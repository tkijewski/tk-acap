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
        # Generate the necessary sounds
ffmpeg -f lavfi -y -t 1 -i sine=frequency=1000:sample_rate=44100 tmp/beep.wav &&
ffmpeg -f lavfi -y -t 0.9 -i anullsrc=r=44100:cl=stereo tmp/pre_tick_silence.wav &&
ffmpeg -f lavfi -y -t 0.1 -i sine=frequency=1500:sample_rate=44100:duration=0.01 tmp/tick.wav
ffmpeg -f lavfi -y -t ${remainingSilence} -i anullsrc=r=44100:cl=stereo tmp/post_beep_silence.wav &&

# Generate a one-second tick sequence (0.9s silence + 0.1s tick)
ffmpeg -i tmp/pre_tick_silence.wav -i tmp/tick.wav -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[out]" -y -map "[out]" tmp/tick_sequence_one_second.wav &&

# Generate the full tick sequence by repeating the one-second tick sequence ${beepPosition} times
ffmpeg -stream_loop $((${beepPosition} - 1)) -i tmp/tick_sequence_one_second.wav -c copy tmp/tick_sequence_full.wav &&

# Concatenate the full tick sequence with the beep, the post-beep silence, and the input path to create the final output
ffmpeg -i tmp/tick_sequence_full.wav -i tmp/beep.wav -i tmp/post_beep_silence.wav -i ${inputPath} -filter_complex "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[out]" -y -map "[out]" silence.wav
rm tmp/pre_tick_silence.wav tmp/tick.wav tmp/beep.wav tmp/post_beep_silence.wav tmp/tick_sequence_one_second.wav tmp/tick_sequence_full.wav
        
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