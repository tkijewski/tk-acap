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
  //keyFilename: 'google-service-account.json',
});

// Create a new storage client
const storage = new Storage({
  //keyFilename: 'google-service-account.json'
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
    
    const docRef = await addDocumentToCollection(obj);

    obj.id = docRef.id;
    return res.json(obj);
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
  let id = req.query.id;

  // Query challenge
  let obj = null;
  let data = null;
  if (id) {
    const querySnapshot = await challengesCollection.doc(id).get();
    if (!querySnapshot.empty) {
      obj = querySnapshot;
      data = obj.data();
    } else {
        res.status(404).send('No challenge found');
    }
  }
  
  if (!obj) {
    const querySnapshot = await challengesCollection.where("number_of_prompts","=",numberOfPrompts).where("status","=","COMPLETE").get();
    let keys = Object.keys(querySnapshot.docs);
    let randomKey = keys[Math.floor(Math.random() * keys.length)];
    obj = querySnapshot.docs[randomKey];
    
    data = obj.data();
    delete data.replicate_id;
    delete data.created_at;
    delete data.challenge_answer;
    delete data.updated_at;
    delete data.beep_position;
    delete data.status;
    delete data.start_play;
  }

  return res.json({
      id: obj.id,
      ...data
  });

});

app.post('/v1/challenge/:id/play', async (req, res) => { 

  // Reference to the challenges collection
  const challengesCollection = firestore.collection(process.env.COLLECTION_CHALLENGES);

  let id = req.params.id;

  // Query challenge
  let obj = null;
    const querySnapshot = await challengesCollection.doc(id).get();
    if (querySnapshot.exists) {
      obj = challengesCollection.doc(id);
    } else {
        return res.status(404).send('No challenge found');
    }

  if (typeof querySnapshot.data().start_play === 'number') {
      return res.json({
        id: obj.id,
        error: "already playing!"
      });
  } else {

    let startPlayTime = Math.floor(Date.now() / 1000);
    await obj.update({
      start_play: startPlayTime
    });
  
    return res.json({
        id: obj.id,
        start_play: startPlayTime
    });
  }
  

});

app.post('/v1/challenge/:id/beep', async (req, res) => { 

  // Reference to the challenges collection
  const challengesCollection = firestore.collection(process.env.COLLECTION_CHALLENGES);

  let id = req.params.id;

  // Query challenge
  let obj = null;
  const querySnapshot = await challengesCollection.doc(id).get();
  if (querySnapshot.exists) {
    obj = challengesCollection.doc(id);
    var data = querySnapshot.data();
  } else {
      return res.status(404).send('No challenge found');
  }

  if (typeof data.start_play !== 'number') {
      return res.json({
        id: obj.id,
        error: "Not playing!"
      });
  }

  let startPlayTime = data.start_play;
  let expectedBeepTime = startPlayTime + data.beep_position;
  let now = Math.floor(Date.now() / 1000);

  if (Math.abs(now-expectedBeepTime) <= 1) {
    res.json({
      id: obj.id,
      success: true
    });
  } else {
    res.json({
      id: obj.id,
      success: false
    });
  }

  await obj.update({
    start_play: null
  });

});

app.post('/v1/challenge/:id/answer/:answer', async (req, res) => { 

  // Reference to the challenges collection
  const challengesCollection = firestore.collection(process.env.COLLECTION_CHALLENGES);

  let id = req.params.id;
  let answer = req.params.answer;

  // Query challenge
  let obj = null;
  const querySnapshot = await challengesCollection.doc(id).get();
  if (querySnapshot.exists) {
    obj = challengesCollection.doc(id);
    var data = querySnapshot.data();
  } else {
      return res.status(404).send('No challenge found');
  }

  if (typeof data.start_play !== 'number') {
    return res.json({
      id: obj.id,
      success: false
    });
  }

  let correctAnswer = data.challenge_answer;

  if (Number(correctAnswer) === Number(answer)) {
    return res.json({
      id: obj.id,
      success: true
    });
  } else {
    return res.json({
      id: obj.id,
      success: false
    });
  }

});


app.get('/v1/check-challenge', async (req, res) => { 

  if (!req.query.id) {
    return res.status(400).send('ID required');
  }

  if (!req.query.beep_position) {
    return res.status(400).send('Beep location required');
  }

  if (!req.query.prompt_guess) {
    return res.status(400).send('Prompt guess required');
  }

  const challenge_id = req.query.id;
  const beep_position = req.query.beep_position;
  const prompt_guess = req.query.prompt_guess;

  // Reference to the challenges collection
  const challengesCollection = firestore.collection(process.env.COLLECTION_CHALLENGES);

  // Query challenge
  const querySnapshot = await challengesCollection.doc(challenge_id).get();
  if (querySnapshot.exists) {
    const challengeData = querySnapshot.data();
    const beepPositionCorrect = validateBeepBasedOnChallenge(challengeData,beep_position);
    const promptGuessCorrect = validatePromptGuessBasedOnChallenge(challengeData,prompt_guess);

    let obj = {};
    //obj.beep_position_success = beepPositionCorrect;
    //obj.prompt_guess_success = promptGuessCorrect;

    obj.success = beepPositionCorrect && promptGuessCorrect;

    return res.status(200).json(obj);

  } else {
      return res.status(404).send('Challenge not found');
  }

});




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
        challenge_sound_url: 'https://storage.googleapis.com/'+process.env.GCS_BUCKET_NAME+'/'+destinationFileName,
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

    return docRef;

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


function validateBeepBasedOnChallenge(challengeData, beepPosition)
{
  const expectedBeepPosition = challengeData.beep_position; //in seconds
  const providedBeepPosition = beepPosition; //in seconds

  const beepPositionVariance = Math.abs(expectedBeepPosition-providedBeepPosition);

  if (beepPositionVariance <= 1) {
    return true;
  } else {
    return false;
  }
}

function validatePromptGuessBasedOnChallenge(challengeData, prompt_guess)
{
  const expectedPromptGuess = challengeData.challenge_answer;

  return expectedPromptGuess == prompt_guess;
}


//request

//PLAY START

//bell ring time

//prompt answer