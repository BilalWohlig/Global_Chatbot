const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const schema = new Schema(
  {
    question: {
      type: String,
    },
    answer: {
      type: String,
    },
    policyId: {
      type: Schema.Types.ObjectId,
      ref: "Policies",
    },
    status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: "Active"
    }
  },
  { timestamps: true }
);
module.exports = mongoose.model("FrequentlyAskedQuestions", schema);
