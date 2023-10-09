const express = require('express')
const router = express.Router()
const __constants = require('../../config/constants')
const validationOfAPI = require('../../middlewares/validation')
const Pinecone = require('../../services/pinecone/pineconeMethods')
const authentication = require('../../middlewares/auth/authentication')
const logMiddleware = require('../../middlewares/UserActivityLogs')

// const cache = require('../../middlewares/requestCacheMiddleware') // uncomment the statement whenever the redis cache is in use.

/**
 * @namespace -PINECONE-MODULE-
 * @description API’s related to PINECONE module.
 */
/**
 * @memberof -Pinecone-module-
 * @name postPing
 * @path {POST} /api/pinecone/createEmbedding
 * @description Bussiness Logic :- In postIndex API, we are creating a new index in pinecone
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success  - Response got successfully.
 * @response {string} metadata.data - It will return the data.
 * @code {200} if the msg is success the api returns succcess message.
 * @author Bilal Sani, 20th April 2023
 * *** Last-Updated :- Bilal Sani, 20th April 2023 ***
 */
const validationSchema = {
  type: 'object',
  required: true,
  properties: {
    indexName: { type: 'string', required: true, minLength: 3 }
  }
}
const validation = (req, res, next) => {
  return validationOfAPI(req, res, next, validationSchema, 'body')
}
const receiveUserMessage = async (req, res) => {
  try {
    const data = await Pinecone.receiveUserMessage(req.body)
    if (data == 'Success') {
      res.sendStatus(200)
    } else if (data == 'Not found') {
      res.sendStatus(404)
    }
  } catch (err) {
    return res.sendJson({
      type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.err || err
    })
  }
}

router.post(
  '/webhook',
  //   logMiddleware.userActivityLog,
  //   authentication.authenticate("jwt", { session: false }),
  //   validation,
  receiveUserMessage
)
// router.post('/postPing', cache.route(100), validation, ping) // example for redis cache in routes
module.exports = router
