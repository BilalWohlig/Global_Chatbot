const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    userReply: {
      type: String,
      enum: ['Yes', 'No']
    }
    // reason: {
    //   type: String
    // },
  },
  { timestamps: true }
)
module.exports = mongoose.model('HelpfulLogs', schema)
