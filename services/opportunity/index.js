require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
  console.log(`Opportunity Service running on port ${PORT}`);
});
