const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    insuranceDocs: {
      type: Schema.Types.ObjectId,
      ref: 'Policies'
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    question: {
      type: String
    },
    answer: {
      type: String
    },
    gptLogs: {
      type: Object
    }
  },
  { timestamps: true }
)
module.exports = mongoose.model('QnA', schema)
