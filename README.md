# tk-acap

## .env
```
OPENAI_KEY=
REPLICATE_KEY=
CHATGPT_MODEL=gpt-3.5-turbo
REPLICATE_VERSION=9b8643c06debace10b9026f94dcb117f61dc1fee66558a09cde4cfbf51bcced6

AUDIO_GENERATION_COMPLETE_WEBHOOK_URL=<app_url>/receive-audio-challenge
AUDIO_GENERATION_TIME_S=10

NUMBER_OF_PROMPTS_TO_GENERATE=4

COLLECTION_CHALLENGES=challenges
COLLECTION_REQUESTS=requests

GCS_BUCKET_NAME=
```
## Google Cloud Run
- environment variables (above) must be set

## API

`POST /v1/generate` - Will ask chatgpt for prompts, and submit one to replicate. The replicate webhook will be received and stored
`POST /v1/get-challenge` - Will return a challenge from the db


