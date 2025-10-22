SETTING UP

Make sure you have an .env file with this format...

"APP_ID="1967947"
PRIVATE_KEY_PATH="your-private-key-path"
WEBHOOK_SECRET="your-webhook-secret" 
OPENAI_API_KEY=sk-your-api-key"

RUNNING

Open two terminals.

Terminal one command:
npx smee -u WEBHOOK_PROXY_URL -t http://localhost:3000/api/webhook

WEBHOOK_PROXY_URL = your webhook proxy url

Terminal two command:
npm run server