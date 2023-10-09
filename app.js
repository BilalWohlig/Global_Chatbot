const express = require('express')
const http = require('http')
const bodyParser = require('body-parser')
const cors = require('cors')
const path = require('path')
const cluster = require('cluster')
const __db = require('./lib/db')
const __config = require('./config')
const __constants = require('./config/constants')
const helmet = require('helmet')
const authMiddleware = require('./middlewares/auth/authentication')
const numCPUs = __config.clusterNumber || 0
const fs = require('fs')
const fileUpload = require('express-fileupload')
const myToken = process.env.MY_TOKEN
const token = process.env.TOKEN
const axios = require('axios')

class httpApiWorker {
  constructor () {
    this.app = {}
  }

  async startServer () {
    console.debug('inside ~function=startServer. STARTING http_api WORKER')
    const vm = this
    await __db.init().then((result) => {
      vm.runExpressServer()
    }).catch((error) => {
      console.log('Error while server start :: ', error)
      process.exit(1)
    })
  }

  runExpressServer () {
    console.debug('info inside ~function=runExpressServer.')
    const vm = this
    vm.app = express()
    vm.app.use(helmet({
      noCache: true
    }))
    vm.app.use(fileUpload())
    const sixtyDaysInSeconds = 5184000
    vm.app.use(helmet.hsts({
      maxAge: sixtyDaysInSeconds
    }))
    vm.app.use(helmet.frameguard({
      action: 'deny'
    }))
    vm.app.set('views', path.join(process.env.PWD, 'views'))
    vm.app.set('view engine', 'hbs')
    vm.app.use((req, res, next) => {
      if (!req.timedout) {
        next()
      } else {
        res.sendJson({
          type: __constants.RESPONSE_MESSAGES.SERVER_TIMEOUT,
          data: {
            message: 'request from client timedout'
          }
        })
      }
      req.on('timeout', (time, next) => {
        console.log('error :: inside ~function=runExpressServer. haltOnTimedout, server response timedout')
        res.sendJson({
          type: __constants.RESPONSE_MESSAGES.SERVER_TIMEOUT,
          data: {
            message: 'server timed out after ' + time + ' milliseconds'
          }
        })
      })
    })
    vm.app.use(bodyParser.json({
      limit: '100mb'
    })) // to support JSON-encoded bodies
    vm.app.use(bodyParser.urlencoded({ // to support URL-encoded bodies
      extended: true,
      limit: '100mb'
    }))
    vm.app.use((err, req, res, next) => {
      // This check makes sure this is a JSON parsing issue, but it might be
      // coming from any middleware, not just body-parser:
      if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.log('Error while sending request (JSON invalid)', err)
        return res.sendJson({
          type: __constants.RESPONSE_MESSAGES.INVALID_REQUEST,
          err: ['invalid request']
        })
      }
      next()
    })
    vm.app.use(cors({
      exposedHeaders: ['Content-disposition']
    }))
    authMiddleware.initialize(vm.app)
    require('./routes')(vm.app)

    vm.app.listen(process.env.WEBHOOK_PORT || 1337, () => console.log('webhook is listening'))

    vm.app.get('/webhook', (req, res) => {
      const mode = req.query['hub.mode']
      const challenge = req.query['hub.challenge']
      const token = req.query['hub.verify_token']

      if (mode && token) {
        if (mode == 'subscribe' && token == myToken) {
          res.status(200).send(challenge)
        } else {
          res.status(403)
        }
      }
    })

    vm.app.get('/', (req, res) => {
      res.status(200).send('Welcome to the webhook')
    })

    // vm.app.post("/webhook", (req, res) => {
    //   // Parse the request body from the POST
    //   let body = req.body;

    //   // Check the Incoming webhook message
    //   console.log(JSON.stringify(body, null, 2));

    //   // info on WhatsApp text message payload: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples#text-messages
    //   if (req.body.object) {
    //     if (
    //       body.entry &&
    //       body.entry[0].changes &&
    //       body.entry[0].changes[0] &&
    //       body.entry[0].changes[0].value.messages &&
    //       body.entry[0].changes[0].value.messages[0]
    //     ) {
    //       let phone_number_id =
    //         body.entry[0].changes[0].value.metadata.phone_number_id;
    //       let from = body.entry[0].changes[0].value.messages[0].from; // extract the phone number from the webhook payload
    //       let msg_body = body.entry[0].changes[0].value.messages[0].text.body; // extract the message text from the webhook payload
    //       axios({
    //         method: "POST", // Required, HTTP method, a string, e.g. POST, GET
    //         url:
    //           "https://graph.facebook.com/v12.0/" +
    //           phone_number_id +
    //           "/messages?access_token=" +
    //           token,
    //         data: {
    //           messaging_product: "whatsapp",
    //           to: from,
    //           text: { body: "This is your message: " + msg_body },
    //         },
    //         headers: { "Content-Type": "application/json" },
    //       });
    //     }
    //     res.sendStatus(200);
    //   } else {
    //     // Return a '404 Not Found' if event is not from a WhatsApp API
    //     res.sendStatus(404);
    //   }
    // });

    vm.app.use((req, res, next) => {
      const err = new Error('Not Found')
      res.sendJson({
        type: __constants.RESPONSE_MESSAGES.NOT_FOUND,
        data: {
          message: 'not found'
        },
        err: err
      })
    })
    if (cluster.isMaster && numCPUs > 0) {
      for (let i = 0; i < numCPUs; i++) {
        cluster.fork()
      }
    } else {
      vm.app.server = http.createServer(vm.app)
      vm.app.server.listen(__config.port)
      vm.app.server.timeout = __constants.SERVER_TIMEOUT
    }
    const apiPrefix = __config.addBaseUrlPrefix === true ? '/' + __config.api_prefix : ''
    console.log('Application listening on Port :', __config.port, '\nApplication Test URL : ', __config.base_url + apiPrefix + '/api/healthCheck/getping')

    const stopGraceFully = () => {
      vm.app.server.close(async (error) => {
        console.log('inside ~function=runExpressServerserver is closed', error)
        await __db.close()
        console.debug('server is closed')
        process.exit(error ? 1 : 0)
      })
    }

    process.on('SIGINT', () => {
      console.log('SIGINT received')
      stopGraceFully()
    })
    process.on('SIGTERM', () => {
      console.log('SIGTERM received')
      stopGraceFully()
    })
    process.on('uncaughtException', (err) => {
      console.log('error :: inside ~function=runExpressServer. ##### SERVER CRASH ##### \n', err, '\n ########## END ##########')
    })

    // to avoid issue of monggose schema register which comes if any schema is used in populate before being required anywhere
    const normalizedPath = path.join(__dirname, 'mongooseSchema')
    fs.readdirSync(normalizedPath).forEach(file => { if (file.endsWith('.js')) require(path.join(normalizedPath, file)) })
  }
}

class Worker extends httpApiWorker {
  start () {
    console.debug((new Date()).toLocaleString() + '   >> Worker PID:', process.pid)
    // call initialization function of extended worker class
    super.startServer()
    // const express_server = new http_api();
    // express_server.startServer();
  }
}

module.exports.worker = new Worker()
