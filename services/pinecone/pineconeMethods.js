const { Pinecone } = require('@pinecone-database/pinecone')
const pinecone = new Pinecone({
  environment: process.env.PINECONE_ENVIRONMENT,
  apiKey: process.env.PINECONE_API_KEY
})
const { Configuration, OpenAIApi } = require('openai')
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})
const openai = new OpenAIApi(configuration)
const pdfParse = require('pdf-parse')
const authentication = require('../../middlewares/auth/authentication')
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter')
const { Document } = require('langchain/document')
const User = require('../../mongooseSchema/User.js')
const Policy = require('../../mongooseSchema/Policies.js')
const QnA = require('../../mongooseSchema/QnA.js')
const DocumentId = require('../../mongooseSchema/DocumentId.js')
const Support = require('../../mongooseSchema/SupportOptions.js')
const HelpfulLogs = require('../../mongooseSchema/HelpfulLogs.js')
const FAQ = require('../../mongooseSchema/FrequentlyAskedQuestions.js')
const Greeting = require('../../mongooseSchema/Greeting.js')
const axios = require('axios')
const moment = require('moment')

class PineconeChatbot {
  async sleep (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async createUser (body) {
    const existingUser = await User.findOne({ email: body.email })
    if (existingUser) {
      const userObj = {
        name: existingUser.name,
        mobile: existingUser.mobile,
        email: existingUser.email,
        id: existingUser._id
      }
      const token = authentication.setToken(userObj, 86400)
      return {
        user: existingUser,
        token: token
      }
    }
    const userObj = {
      name: body.name,
      mobile: body.mobile,
      email: body.email
    }
    const newUser = new User(userObj)
    await newUser.save()
    userObj.id = newUser._id
    const token = authentication.setToken(userObj, 86400)
    return {
      user: newUser,
      token: token
    }
  }

  async deleteAllVectorsFromNamespace (indexName) {
    const index = pinecone.Index(indexName)
    await index.deleteAll()
    return 'Deleted'
  }

  async deleteSpecificVectorsFromNamespace (indexName, policyId) {
    const index = pinecone.Index(indexName)
    await index.delete({
      deleteRequest: {
        filter: {
          policyId: { $eq: policyId }
        }
      }
    })
    return 'Deleted'
  }

  async receiveUserMessage (requestBody) {
    const token = process.env.TOKEN
    // Parse the request body from the POST
    const body = requestBody

    // Check the Incoming webhook message
    console.log(JSON.stringify(body, null, 2))

    // info on WhatsApp text message payload: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples#text-messages
    if (requestBody.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const phone_number_id =
          body.entry[0].changes[0].value.metadata.phone_number_id
        const from = body.entry[0].changes[0].value.messages[0].from // extract the phone number from the webhook payload
        const userWhatsappId = body.entry[0].changes[0].value.contacts[0].wa_id
        const user = await User.findOne({ mobile: userWhatsappId }).populate(
          'insuranceDocs'
        )
        const userDocIds = user.insuranceDocs.map((userDoc) => {
          return userDoc._id.toString()
        })
        const lastUserGreeting = await Greeting.findOne({ userId: user._id })
        const lastUserEndConvo = await HelpfulLogs.findOne({ userId: user._id }).sort({ _id: -1 })
        let lastUserGreetingDate = ''
        let lastUserEndConvoDate = ''
        if (lastUserGreeting) {
          lastUserGreetingDate = moment(lastUserGreeting.updatedAt)
        }
        if (lastUserEndConvo) {
          lastUserEndConvoDate = moment(lastUserEndConvo.createdAt)
        }
        let userMessage = ''
        let message_text = ''
        if (body.entry[0].changes[0].value.messages[0].type == 'text') {
          message_text = body.entry[0].changes[0].value.messages[0].text.body
          const replySentiment = await this.replyClassification(message_text)
          userMessage = replySentiment.choices[0].message.content
        } else if (body.entry[0].changes[0].value.messages[0].type == 'interactive') {
          if (body.entry[0].changes[0].value.messages[0].interactive.list_reply) {
            userMessage = body.entry[0].changes[0].value.messages[0].interactive.list_reply.title
          } else if (body.entry[0].changes[0].value.messages[0].interactive.button_reply) {
            userMessage = body.entry[0].changes[0].value.messages[0].interactive.button_reply.title
          }
        }
        if (userMessage == 'Greeting' || (lastUserGreetingDate == '' || lastUserEndConvoDate == '') || (lastUserGreetingDate > lastUserEndConvoDate)) {
          if (body.entry[0].changes[0].value.messages[0].type == 'text') {
            const msg_body = body.entry[0].changes[0].value.messages[0].text.body
            const replySentiment = await this.replyClassification(msg_body)
            const userReply = replySentiment.choices[0].message.content
            const docId = await DocumentId.find({
              userId: user._id,
              status: 'Success'
            }).sort({ updatedAt: -1 })
            if (userReply == 'Greeting') {
              const existingGreeting = await Greeting.findOne({ userId: user._id })
              if (!existingGreeting) {
                const greetingObj = {
                  userId: user._id,
                  message: msg_body
                }
                const newGreeting = new Greeting(greetingObj)
                await newGreeting.save()
              } else {
                existingGreeting.updatedAt = Date.now()
                existingGreeting.message = msg_body
                await existingGreeting.save()
              }
              // const supportOptions = await Support.find({ status: 'Active' })
              // const userSupportOptions = []
              // supportOptions.forEach((option) => {
              //   const obj = {
              //     id: option._id,
              //     title: option.name
              //   }
              //   userSupportOptions.push(obj)
              // })
              // await axios({
              //   method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
              //   url:
              //     'https://graph.facebook.com/v18.0/' +
              //     phone_number_id +
              //     '/messages',
              //   data: {
              //     messaging_product: 'whatsapp',
              //     recipient_type: 'individual',
              //     to: from,
              //     type: 'interactive',
              //     interactive: {
              //       type: 'list',
              //       header: {
              //         type: 'text',
              //         text: 'Priya'
              //       },
              //       body: {
              //         text: `Hello ${user.name}! My name is Priya, it's great to have you here. Please let me know what can I assist you with by choosing from the options below`
              //       },
              //       action: {
              //         button: 'Options',
              //         sections: [
              //           {
              //             rows: userSupportOptions
              //           }
              //         ]
              //       }
              //     }
              //   },
              //   headers: {
              //     'Content-Type': 'application/json',
              //     Authorization: `Bearer ${token}`
              //   }
              // })
              const allUserDocs = user.insuranceDocs
              const userOptions = []
              allUserDocs.forEach((doc) => {
                const obj = {
                  id: doc._id.toString(),
                  title: doc.name
                }
                userOptions.push(obj)
              })
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  recipient_type: 'individual',
                  to: from,
                  type: 'interactive',
                  interactive: {
                    type: 'list',
                    header: {
                      type: 'text',
                      text: 'Priya'
                    },
                    body: {
                      text: `Hello ${user.name}! My name is Priya, it's great to have you here. Please let me know which policy do you have questions about. I'm here to help you with any questions or concerns you may have related to our policies.`
                    },
                    action: {
                      button: 'Options',
                      sections: [
                        {
                          rows: userOptions
                        }
                      ]
                    }
                  }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            }
            else if (userReply == 'Question') {
              const answer = await this.askQuestionAboutDoc(
                'explainer',
                msg_body,
                user._id,
                docId[0].docId
              )
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  to: from,
                  text: { body: answer }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  recipient_type: 'individual',
                  to: from,
                  type: 'interactive',
                  interactive: {
                    type: 'button',
                    body: {
                      text: 'To change your policy choice, click the first button. To end the conversation, click the second button.'
                    },
                    action: {
                      buttons: [
                        {
                          type: 'reply',
                          reply: {
                            id: docId[0]._id,
                            title: 'Change Policy Choice'
                          }
                        },
                        {
                          type: 'reply',
                          reply: {
                            id: user._id,
                            title: 'End Conversation'
                          }
                        }
                      ]
                    }
                  }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            } 
            else {
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  to: from,
                  text: { body: 'Sorry, it seems like there was an issue. Please follow the instructions for a smoother experience.' }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            }
          } else if (
            body.entry[0].changes[0].value.messages[0].type == 'interactive'
          ) {
            let msg_reply = ''
            let msg_reply_id = ''
            console.log()
            if (
              body.entry[0].changes[0].value.messages[0].interactive.list_reply
            ) {
              msg_reply =
                body.entry[0].changes[0].value.messages[0].interactive.list_reply
                  .title
              msg_reply_id =
                body.entry[0].changes[0].value.messages[0].interactive.list_reply
                  .id
            }
            let button_reply = ''
            if (
              body.entry[0].changes[0].value.messages[0].interactive.button_reply
            ) {
              button_reply =
                body.entry[0].changes[0].value.messages[0].interactive
                  .button_reply.title
              msg_reply_id =
                body.entry[0].changes[0].value.messages[0].interactive
                  .button_reply.id
            }
            const userPolicy = await Policy.findOne({
              $or: [{ name: msg_reply }, { _id: msg_reply_id }]
            })
            if (
              msg_reply == 'Policy Questioning' ||
              msg_reply == 'Change Policy' ||
              button_reply == 'Change Policy Choice'
            ) {
              const allUserDocs = user.insuranceDocs
              const userOptions = []
              allUserDocs.forEach((doc) => {
                const obj = {
                  id: doc._id.toString(),
                  title: doc.name
                }
                userOptions.push(obj)
              })
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  recipient_type: 'individual',
                  to: from,
                  type: 'interactive',
                  interactive: {
                    type: 'list',
                    header: {
                      type: 'text',
                      text: 'Priya'
                    },
                    body: {
                      text: "Let's get you the information you need. Please select the policy you have questions about. We're here to help you with any questions or concerns you may have related to our policies."
                    },
                    action: {
                      button: 'Options',
                      sections: [
                        {
                          rows: userOptions
                        }
                      ]
                    }
                  }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            } else if (
              msg_reply == 'Continue Asking'
            ) {
              let msgToBeSent = ''
              const objectId = msg_reply_id
              const policy = await Policy.findById(objectId)
              if (userDocIds.includes(objectId.toString())) {
                msgToBeSent = `Of Course! Please go ahead and ask any questions you may have about your ${policy.name}. We're here to provide you with all the information and assistance you need. Just type your question, and I'll be happy to help with any concerns or inquiries you have`
              } else {
                msgToBeSent =
                  'Invalid Document Id. Please upload your document and try again'
              }
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  to: from,
                  text: { body: msgToBeSent }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
              let existingDocId = await DocumentId.findOne({
                userId: user._id,
                docId: objectId
              })
              if (!existingDocId) {
                const docObj = {
                  docId: objectId,
                  userId: user._id,
                  answerFromWhatsApp: msgToBeSent,
                  status: 'Success',
                  updatedAtOld: Date.now()
                }
                existingDocId = new DocumentId(docObj)
                await existingDocId.save()
              } else {
                existingDocId.updatedAtOld = existingDocId.updatedAt
                existingDocId.updatedAt = Date.now()
                existingDocId.answerFromWhatsApp = msgToBeSent
                await existingDocId.save()
              }
            } else if (
              msg_reply.includes('FAQ') || button_reply.includes('FAQ')
            ) {
              const answerFromFAQ = await FAQ.findById(msg_reply_id)
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  to: from,
                  text: { body: answerFromFAQ.answer }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
              const userQuestionChoices = [
                {
                  id: answerFromFAQ.policyId,
                  title: 'Continue Asking'
                },
                {
                  id: answerFromFAQ._id,
                  title: 'Change Policy'
                },
                {
                  id: user._id,
                  title: 'End Conversation'
                }
              ]
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  recipient_type: 'individual',
                  to: from,
                  type: 'interactive',
                  interactive: {
                    type: 'list',
                    header: {
                      type: 'text',
                      text: 'Priya'
                    },
                    body: {
                      text: 'Would you like to continue asking questions about the current policy, change your policy choice or end this conversation? Feel free to let me know how I can assist you further.'
                    },
                    action: {
                      button: 'Please Choose',
                      sections: [
                        {
                          rows: userQuestionChoices
                        }
                      ]
                    }
                  }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            } else if (msg_reply == 'End Conversation' || button_reply == 'End Conversation') {
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  recipient_type: 'individual',
                  to: from,
                  type: 'interactive',
                  interactive: {
                    type: 'button',
                    body: {
                      text: 'Was this information helpful to you'
                    },
                    action: {
                      buttons: [
                        {
                          type: 'reply',
                          reply: {
                            id: user._id,
                            title: 'Yes'
                          }
                        },
                        {
                          type: 'reply',
                          reply: {
                            id: user.insuranceDocs[0]._id,
                            title: 'No'
                          }
                        }
                      ]
                    }
                  }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            } else if (button_reply == 'Yes') {
              const logsObj = {
                userId: user._id,
                userReply: 'Yes'
              }
              const logs = new HelpfulLogs(logsObj)
              await logs.save()
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  to: from,
                  text: {
                    body: `Goodbye ${user.name}! 👋 We're delighted that we could assist you. If you ever wish to start a new conversation with me, just send a 'Hey' or a 'Hi' and I'll be right here to assist you. Have a great day!`
                  }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            } else if (button_reply == 'No') {
              const logsObj = {
                userId: user._id,
                userReply: 'No'
              }
              const logs = new HelpfulLogs(logsObj)
              await logs.save()
              await axios({
                method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
                url:
                  'https://graph.facebook.com/v18.0/' +
                  phone_number_id +
                  '/messages',
                data: {
                  messaging_product: 'whatsapp',
                  to: from,
                  text: {
                    body: 'I\'m sorry to hear that. 😔 We will look to improve ourselves in the future. We\'re here to assist you better. Have a great day!'
                  }
                },
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                }
              })
            } else if (userPolicy) {
              let msgToBeSent = ''
              // const objectId = msg_reply_id
              // const policy = await Policy.findById(objectId)
              if (userDocIds.includes(userPolicy._id.toString())) {
                msgToBeSent = `Great! Here are some of the most frequently asked questions (FAQs) of your ${userPolicy.name} to get you started. If you still have a question or need more clarification, you can type and ask your specific question. I'm here to assist you with any queries you may have. Just let me know how I can help!`
              } else {
                msgToBeSent =
                  'Invalid Document Id. Please upload your document and try again'
              }
              let existingDocId = await DocumentId.findOne({
                userId: user._id,
                docId: userPolicy._id
              })
              if (!existingDocId) {
                const docObj = {
                  docId: userPolicy._id,
                  userId: user._id,
                  answerFromWhatsApp: msgToBeSent,
                  status: 'Success'
                }
                existingDocId = new DocumentId(docObj)
                // console.log('******', existingDocId)
                await existingDocId.save()
              } else {
                existingDocId.updatedAt = Date.now()
                existingDocId.answerFromWhatsApp = msgToBeSent
                await existingDocId.save()
              }
              const faqs = await FAQ.find({
                status: 'Active',
                policyId: userPolicy._id
              })
              let faqQuestions = []
              faqs.forEach((faq, i) => {
                const obj = {
                  id: faq._id,
                  title: `FAQ ${i+1}`,
                  description: faq.question
                }
                faqQuestions.push(obj);
              })
              console.log(faqQuestions)
              console.log(userPolicy)
              await axios({
                method: "POST", // Required, HTTP method, a string, e.g. POST, GET
                url:
                "https://graph.facebook.com/v18.0/" +
                phone_number_id +
                "/messages",
                data: {
                  messaging_product: "whatsapp",
                  recipient_type: "individual",
                  to: from,
                  type: "interactive",
                  interactive: {
                    type: "list",
                    header: {
                      type: "text",
                      text: "Priya",
                    },
                    body: {
                      text: `Great! Here are some of the most frequently asked questions (FAQs) of your ${userPolicy.name} to get you started. If you still have a question or need more clarification, you can type and ask your specific question. I'm here to assist you with any queries you may have. Just let me know how I can help!`,
                    },
                    action: {
                      button: "FAQ",
                      sections: [
                        {
                          rows: faqQuestions
                        },
                      ],
                    },
                  },
                },
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
              });
              // await axios({
              //   method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
              //   url:
              //     'https://graph.facebook.com/v18.0/' +
              //     phone_number_id +
              //     '/messages',
              //   data: {
              //     messaging_product: 'whatsapp',
              //     to: from,
              //     text: {
              //       body: `Great! Here are some of the most frequently asked questions (FAQs) of your ${userPolicy.name} to get you started. If you still have a question or need more clarification, you can type and ask your specific question. I'm here to assist you with any queries you may have. Just let me know how I can help!`
              //     }
              //   },
              //   headers: {
              //     'Content-Type': 'application/json',
              //     Authorization: `Bearer ${token}`
              //   }
              // })
              // if (faqs.length > 0) {
              //   for (let i = 0; i < faqs.length; i++) {
              //     const faq = faqs[i]
              //     await axios({
              //       method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
              //       url:
              //         'https://graph.facebook.com/v18.0/' +
              //         phone_number_id +
              //         '/messages',
              //       data: {
              //         messaging_product: 'whatsapp',
              //         recipient_type: 'individual',
              //         to: from,
              //         type: 'interactive',
              //         interactive: {
              //           type: 'button',
              //           body: {
              //             text: `Q${i + 1}. ${faq.question}`
              //           },
              //           action: {
              //             buttons: [
              //               {
              //                 type: 'reply',
              //                 reply: {
              //                   id: faq._id,
              //                   title: `FAQ ${i + 1} Answer`
              //                 }
              //               }
              //             ]
              //           }
              //         }
              //       },
              //       headers: {
              //         'Content-Type': 'application/json',
              //         Authorization: `Bearer ${token}`
              //       }
              //     })
              //   }
              // } else {
              //   await axios({
              //     method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
              //     url:
              //       'https://graph.facebook.com/v18.0/' +
              //       phone_number_id +
              //       '/messages',
              //     data: {
              //       messaging_product: 'whatsapp',
              //       to: from,
              //       text: {
              //         body: `Currently, there are no FAQs available for ${userPolicy.name}. Feel free to type your question, and we'll be happy to assist you.`
              //       }
              //     },
              //     headers: {
              //       'Content-Type': 'application/json',
              //       Authorization: `Bearer ${token}`
              //     }
              //   })
              // }
            }
          }
        } else {
          await axios({
            method: 'POST', // Required, HTTP method, a string, e.g. POST, GET
            url:
              'https://graph.facebook.com/v18.0/' +
              phone_number_id +
              '/messages',
            data: {
              messaging_product: 'whatsapp',
              to: from,
              text: {
                body: `Hey ${user.name}! 👋 To begin a new conversation, please send a 'Hey' or a 'Hi' and I will be able to assist you.`
              }
            },
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            }
          })
        }
      }
      return 'Success'
    } else {
      // Return a '404 Not Found' if event is not from a WhatsApp API
      return 'Not found'
    }
  }

  async verifyWebhook (query) {
    const myToken = process.env.MY_TOKEN
    const mode = query['hub.mode']
    const challenge = query['hub.challenge']
    const token = query['hub.verify_token']

    if (mode && token) {
      if (mode == 'subscribe' && token == myToken) {
        return challenge
      } else {
        return 'Errorrrr'
      }
    }
  }

  async pushDataToPineconeIndex (index_name, documentData, userId) {
    try {
      const data = []
      let rawData
      if (documentData.length != undefined) {
        for (let i = 0; i < documentData.length; i++) {
          const doc = documentData[i]
          rawData = await pdfParse(doc)
          data.push(rawData.text.trim())
        }
      } else {
        rawData = await pdfParse(documentData)
        data.push(rawData.text.trim())
      }
      const index = pinecone.Index(index_name)
      const batch_size = 50
      const finalContext = data.join(' ')
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 100
      })
      const docs = await splitter.splitDocuments([
        new Document({ pageContent: finalContext })
      ])
      for (const doc of docs) {
        doc.id = Math.random()
          .toString(36)
          .substring(2, 12 + 2)
      }

      //   await User.findByIdAndUpdate(userId, { $set: { insuranceDocs: docs } });
      const policyObj = {
        insuranceDocs: docs.map((doc) => {
          const obj = {
            id: doc.id,
            metadata: doc.metadata
          }
          return obj
        })
      }
      const newPolicy = new Policy(policyObj)
      await newPolicy.save()

      for (let i = 0; i < docs.length; i += batch_size) {
        const i_end = Math.min(docs.length, i + batch_size)
        const meta_batch = docs.slice(i, i_end)
        const ids_batch = meta_batch.map((x) => x.id)
        const texts_batch = meta_batch.map((x) => x.pageContent)
        let response
        try {
          response = await openai.createEmbedding({
            model: 'text-embedding-ada-002',
            input: texts_batch
          })
        } catch (error) {
          const done = false
          while (!done) {
            await this.sleep(5)
            try {
              response = await openai.createEmbedding({
                model: 'text-embedding-ada-002',
                input: texts_batch
              })
            } catch (error) {
              console.log(error.message)
            }
          }
        }
        const embeds = response.data.data.map((record) => record.embedding)
        const meta_batch_cleaned = meta_batch.map((x) => ({
          pageContent: x.pageContent,
          policyId: newPolicy._id
        }))
        const to_upsert = ids_batch.map((id, i) => ({
          id: id,
          values: embeds[i],
          metadata: meta_batch_cleaned[i]
        }))
        // const upsertRequest = {
        //   vectors: to_upsert,
        //   namespace: namespace,
        // };
        // console.log(upsertRequest.vectors[0])
        await index.upsert(to_upsert)
        console.log('Uploaded')
      }
      newPolicy.status = 'Uploaded to Pinecone'
      await newPolicy.save()
      await User.findByIdAndUpdate(userId, {
        $push: { insuranceDocs: newPolicy._id }
      })
      return 'Successfully Uploaded'
    } catch (err) {
      console.log('Error in pushDataToPinecone function :: err', err.message)
      throw new Error(err)
    }
  }

  async askQuestionAboutDoc (indexName, question, userId, insuranceDocId) {
    const user = await User.findById(userId)
    if (user.insuranceDocs.includes(insuranceDocId)) {
      const qnaObj = {
        question: question,
        userId: userId,
        insuranceDocs: insuranceDocId
      }
      const newQuestion = new QnA(qnaObj)
      await newQuestion.save()
      const index = pinecone.Index(indexName)
      let response = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: question
      })
      const xq = response.data.data[0].embedding
      response = await index.query({
        vector: xq,
        filter: { policyId: insuranceDocId.toString() },
        topK: 2,
        includeMetadata: true
        // includeValues: true
      })
      const contexts = response.matches.map(
        (match) => match.metadata.pageContent
      )
      // const scores = response.matches.map((match) => match.score)

      const answer = await this.askChatGPT(contexts, question)
      newQuestion.gptLogs = answer
      newQuestion.answer = answer.choices[0].message.content
      await newQuestion.save()
      // return newQuestion;
      return newQuestion.answer
    }
    return 'User does not have such a policy'
  }

  async askChatGPT (question, context) {
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Answer the question based on the context below'
        },
        {
          role: 'user',
          content: `Context: ${context}
                      Question: ${question}`
        },
        {
          role: 'assistant',
          content: 'Answer: '
        }
      ]
    })
    return response.data
  }

  async replyClassification (reply) {
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content:
            'You are a sentiment classifier. Analyze the text given and classify it accordingly. The classification choices available to you are [Greeting, Question, Appreciation]. Give answer in 1 word only'
        },
        {
          role: 'user',
          content: `Text: ${reply}`
        },
        {
          role: 'assistant',
          content: 'Answer: '
        }
      ]
    })
    return response.data
  }

  async generalReplies (instruction, text) {
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: instruction
        },
        {
          role: 'user',
          content: `Text: ${text}`
        },
        {
          role: 'assistant',
          content: 'Answer: '
        }
      ]
    })
    return response.data
  }
}

module.exports = new PineconeChatbot()
