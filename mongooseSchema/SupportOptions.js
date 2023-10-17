const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    name: {
      type: String
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active'
    }
  },
  { timestamps: true }
)
module.exports = mongoose.model('SupportOptions', schema)
