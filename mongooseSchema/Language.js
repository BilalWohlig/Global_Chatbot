const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    name: {
      type: String
    },
    status: {
      type: String,
      default: 'enabled',
      enum: ['enabled', 'disabled']
    }
  },
  { timestamps: true }
)
module.exports = mongoose.model('Language', schema)
