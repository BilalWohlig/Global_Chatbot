const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    message: {
      type: String
    }
  },
  { timestamps: true }
)
module.exports = mongoose.model('Greeting', schema)
