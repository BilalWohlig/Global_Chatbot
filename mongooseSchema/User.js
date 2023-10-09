const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    name: {
      type: String
    //   required: true
    },
    mobile: {
      type: Number
    //   required: true
    },
    email: {
      type: String
    //   required: true
    },
    insuranceDocs: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Policies'
      }
    ],
    status: {
      type: String,
      enum: ['Enabled', 'Disabled'],
      default: 'Enabled',
      required: true
    }
  },
  { timestamps: true }
)
module.exports = mongoose.model('User', schema)
