const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    docId: {
      type: Schema.Types.ObjectId,
      ref: 'Policies'
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    answerFromWhatsApp: {
      type: String
    },
    status: {
      type: 'String',
      enum: ['Success', 'Failure'],
      default: 'Failure'
    },
    updatedAtOld: {
      type: Date
    }
  },
  { timestamps: true }
)
module.exports = mongoose.model('DocumentId', schema)
