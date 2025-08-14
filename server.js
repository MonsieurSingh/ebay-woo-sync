const express = require('express');
const crypto = require('crypto');

const app = express();
const port = 3000;

// Replace with your values
const VERIFICATION_TOKEN = 'your-ebay-verification-token';
const ENDPOINT_URL = 'https://yourdomain.com/ebay-deletion-callback';

app.get('/ebay-deletion-callback', (req, res) => {
  const challengeCode = req.query.challenge_code;

  if (!challengeCode) {
    return res.status(400).send('Missing challenge_code');
  }

  const hash = crypto.createHash('sha256');
  hash.update(challengeCode);
  hash.update(VERIFICATION_TOKEN);
  hash.update(ENDPOINT_URL);

  const response = hash.digest('base64');

  // eBay expects the raw base64 string in the response body
  res.status(200).send(response);
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

