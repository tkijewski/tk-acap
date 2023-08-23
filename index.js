import dotenv from "dotenv";
import Replicate from "replicate";
import { ChatGPTAPI } from 'chatgpt';
import express from 'express';
import bodyParser from "body-parser";
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { downloadFile, convertWavToMp3, addSilenceBeep } from "./utility.js";
import fs from 'fs';

const app = express();

dotenv.config();

const firestore = new Firestore({
  keyFilename: 'google-service-account.json',
});

// Create a new storage client
const storage = new Storage({
  keyFilename: 'google-service-account.json'
});


const replicate = new Replicate({
  auth: process.env.REPLICATE_KEY,
});

const api = new ChatGPTAPI({
  apiKey: process.env.OPENAI_KEY,
  completionParams: {
    model: process.env.CHATGPT_MODEL,
    temperature: parseFloat(process.env.CHATGPT_TEMPERATURE) || 0.5,
    top_p: parseFloat(process.env.CHATGPT_TOP_P) || 0.8,
  }
})



app.get('/', (req, res) => {
  res.send('ACAP');
});

app.use(bodyParser.json());

// Define the create endpoint

app.post('/v1/generate', async (req, res) => {
    
    const receivedData = req.body;
    const numberOfPrompts = receivedData.number_of_prompts || process.env.NUMBER_OF_PROMPTS_TO_GENERATE;

    let result = await api.sendMessage('\
    provide '+numberOfPrompts+' distinctly unique short music descriptions with a title\
\
    add an element of randomness so they do not overlap\
    \
    add an element of randomness so this request can be repeated again, and they still won\'t overlap\
    \
    distinct enough for a user to guess the sound by the prompt, and distinct enough to not sound similar to one of the other sounds.\
    \
     do not use any language to instruct, such as "craft" or "produce" or "create". \
    \
    response in json format with key names numerical, and nested title and description keys. \
    \
    do not respond with anyting but json')
    const soundsObject = JSON.parse(result.text);

    let keys = Object.keys(soundsObject);
    let randomKey = keys[Math.floor(Math.random() * keys.length)];

    const prediction = await replicate.predictions.create({
      version: process.env.REPLICATE_VERSION,
      input: {
        text: soundsObject[randomKey].description,
        duration: parseInt(process.env.AUDIO_GENERATION_TIME_S)
      },
      webhook: process.env.AUDIO_GENERATION_COMPLETE_WEBHOOK_URL,
      webhook_events_filter: ["completed"]
    });

    const obj = {};
    obj.created_at = Math.floor(Date.now() / 1000);
    obj.replicate_id = prediction.id;
    obj.choices = soundsObject;
    obj.challenge_sound_url = '';
    obj.challenge_answer = randomKey;
    obj.number_of_prompts = numberOfPrompts;
    obj.status = 'PENDING'; //PENDING, COMPLETE
    
    addDocumentToCollection(obj);

    res.json(obj);
});

/*
    { 
      "number_of_prompts": 6,
    }
*/
app.get('/v1/challenge', async (req, res) => { 

  // Reference to the challenges collection
  const challengesCollection = firestore.collection(process.env.COLLECTION_CHALLENGES);

  let numberOfPrompts = req.query.number_of_prompts || process.env.NUMBER_OF_PROMPTS_TO_GENERATE;

  // Query challenge
  const querySnapshot = await challengesCollection.where("number_of_prompts","=",numberOfPrompts).where("status","=","COMPLETE").get();
  let keys = Object.keys(querySnapshot.docs);
  let randomKey = keys[Math.floor(Math.random() * keys.length)];

  let obj = querySnapshot.docs[randomKey];
  let data = obj.data();
  delete data.challenge_answer;
  delete data.status;
  delete data.updated_at;
  delete data.replicate_id;
  delete data.created_at;

  res.json({
      id: obj.id,
      ...data
  });

});

app.get('/v1/check-challenge', async (req, res) => { 
  const challenge_id = req.query.id;

  // Reference to the challenges collection
  const challengesCollection = firestore.collection(process.env.COLLECTION_CHALLENGES);

  // Query challenge
  const querySnapshot = await challengesCollection.doc(challenge_id).get();
  if (!querySnapshot.empty) {
    res.json({
      id: querySnapshot.id,
      ...querySnapshot.data()
  });
  } else {
      res.status(404).send('No challenge found');
  }

});



//app.post('/v1/check-challenge', async (req, res) => { }

app.post('/v1/receive-audio-challenge', async (req, res) => { 
  const receivedData = req.body;

  if (receivedData.status == "succeeded") {
    const challenge = await searchByReplicateId(receivedData.id);

    if (challenge) {

      //convert wav to mp3 and store with cloud storage
      const wavUrl = receivedData.output;
      const downloadPath = './'+receivedData.id+'.wav';
      const outputPath = './'+receivedData.id+'.mp3';


      //if file exists we need to delete, for whatever reason
      try {
        fs.unlinkSync(downloadPath);
        fs.unlinkSync(outputPath);
      } catch (err) {
        console.error('Error:', err.message);
      }
      
      

      //download the wav file from replicate
      let silenceSeconds = 10;
      let beepPosition = Math.floor(Math.random() * silenceSeconds) + 1;
      await downloadFile(wavUrl, downloadPath)
          .then(() => {
              console.log('File downloaded successfully.');
              addSilenceBeep(downloadPath,silenceSeconds,beepPosition);
              return convertWavToMp3(downloadPath, outputPath);
          })
          .then(() => {
              console.log('Conversion complete.');
          })
          .catch(error => {
              console.error('Error:', error);
          });
          
          const localFilePath = outputPath;
          const destinationFileName = 'generated-audio/'+receivedData.id+'.mp3';
          
          //upload mp3 to storage bucket
          try {
            // Uploads a local file to the bucket
            await storage.bucket(process.env.GCS_BUCKET_NAME).upload(localFilePath, {
                destination: destinationFileName,
            });
    
            console.log(`${localFilePath} uploaded to ${process.env.GCS_BUCKET_NAME} as ${destinationFileName}`);
          } catch (error) {
              console.error('ERROR:', error);
          }

        //remove mp3
        try {
          fs.unlinkSync(outputPath);
          fs.unlinkSync(downloadPath);
        } catch (err) {
          console.log(err);
        }
        
      
        //update firstore
      await challenge.update({
        challenge_sound_url: 'https://storage.cloud.google.com/'+process.env.GCS_BUCKET_NAME+'/'+destinationFileName,
        status: "COMPLETE",
        updated_at: Math.floor(Date.now() / 1000),
        beep_position: beepPosition
      });
      res.json({"result":"success"});
      return;
    }
    res.status(200).json({"result":"error: no challenge found"}); //not replicate fault
  }
})

const port = parseInt(process.env.PORT || 80);
app.listen(port, () => {
  console.log(`listening on port ${port}`);
});


async function addDocumentToCollection(data) {
  try {
    const docRef = firestore.collection('challenges').doc();
    await docRef.set(data);

    console.log(`Document written with ID: ${docRef.id}`);
  } catch (error) {
    console.error('Error adding document: ', error);
  }
}

async function searchByReplicateId(id) {
  try {
    // Reference to the challenges collection
    const challengesCollection = firestore.collection(process.env.COLLECTION_CHALLENGES);

    // Query challenge
    const querySnapshot = await challengesCollection.where('replicate_id', '=', id).limit(1).get();

    if (querySnapshot.empty) {
      console.log('No challenges found.');
      return false;
    }
    return challengesCollection.doc(querySnapshot.docs[0].id);

  } catch (error) {
    console.error('Error querying challenge: ', error);
  }
}
