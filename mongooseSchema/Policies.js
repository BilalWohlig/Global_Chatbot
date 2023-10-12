const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    insuranceDocs: {
      type: Array
    },
    status: {
      type: String,
      enum: ['Uploaded to Pinecone', 'Saved in DB'],
      default: 'Saved in DB'
    },
    name: {
      type: String
    }
  },
  { timestamps: true }
)
module.exports = mongoose.model('Policies', schema)
