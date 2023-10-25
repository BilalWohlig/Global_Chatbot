const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema(
  {
    userReply: {
        type: String
    },
    text: {
        type: String,
    },
    textEnglish: {
        type: String,
    },
    moreText: {
        type: String,
    },
    moreTextEnglish: {
        type: String,
    },
    bot: {
        type: String,
    },
    botEnglish: {
        type: String,
    },
    button: {
        type: String,
    },
    buttonEnglish: {
        type: String,
    },
    status: {
        type: String,
        default: 'enabled',
        enum: ['enabled', 'disabled']
    },
    language: {
        type: Schema.Types.ObjectId,
        ref: 'Language'
    },
  },
  { timestamps: true }
)
module.exports = mongoose.model('GeneralReplies', schema)
