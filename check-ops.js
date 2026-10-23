const mongoose = require('mongoose');
const Operation = require('./server/models/Operation');

const MONGODB_URI = 'mongodb+srv://lawofor67_db_user:sRsd5Tfe7nfLz1uJ@cluster0.kehmk7b.mongodb.net/tablephvip?retryWrites=true&w=majority';

async function checkOperations() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const ops = await Operation.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('_id accountId phoneMasked operationType status resultSummary error startedAt finishedAt createdAt');

    console.log('\n=== Recent Operations ===');
    ops.forEach(op => {
      console.log(`\nID: ${op._id}`);
      console.log(`Account: ${op.accountId} (${op.phoneMasked})`);
      console.log(`Type: ${op.operationType}`);
      console.log(`Status: ${op.status}`);
      console.log(`Summary: ${op.resultSummary || 'N/A'}`);
      console.log(`Error: ${op.error || 'N/A'}`);
      console.log(`Started: ${op.startedAt || 'N/A'}`);
      console.log(`Finished: ${op.finishedAt || 'N/A'}`);
      console.log(`Created: ${op.createdAt}`);
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkOperations();
