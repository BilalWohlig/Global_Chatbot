const { Pinecone } = require("@pinecone-database/pinecone");
const pinecone = new Pinecone({
  environment: process.env.PINECONE_ENVIRONMENT,
  apiKey: process.env.PINECONE_API_KEY,
});
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const pdfParse = require("pdf-parse");
const authentication = require("../../middlewares/auth/authentication");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { Document } = require("langchain/document");
const User = require("../../mongooseSchema/User.js");
const Policy = require("../../mongooseSchema/Policies.js");
const QnA = require("../../mongooseSchema/QnA.js");
const DocumentId = require("../../mongooseSchema/DocumentId.js");
const axios = require("axios");
const ObjectId = require("mongoose").Types.ObjectId;
const fs = require("fs");
const base64 = require("base-64");

class PineconeChatbot {
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async createUser(body) {
    const existingUser = await User.findOne({ email: body.email });
    if (existingUser) {
      const userObj = {
        name: existingUser.name,
        mobile: existingUser.mobile,
        email: existingUser.email,
        id: existingUser._id,
      };
      const token = authentication.setToken(userObj, 86400);
      return {
        user: existingUser,
        token: token,
      };
    }
    const userObj = {
      name: body.name,
      mobile: body.mobile,
      email: body.email,
    };
    const newUser = new User(userObj);
    await newUser.save();
    userObj.id = newUser._id;
    const token = authentication.setToken(userObj, 86400);
    return {
      user: newUser,
      token: token,
    };
  }

  async deleteAllVectorsFromNamespace(indexName) {
    const index = pinecone.Index(indexName);
    await index.deleteAll();
    return "Deleted";
  }

  async deleteSpecificVectorsFromNamespace(indexName, policyId) {
    const index = pinecone.Index(indexName);
    await index.delete({
      deleteRequest: {
        filter: {
          policyId: { $eq: policyId },
        },
      },
    });
    return "Deleted";
  }

  async receiveUserMessage(requestBody) {
    const token = process.env.TOKEN;
    // Parse the request body from the POST
    const body = requestBody;

    // Check the Incoming webhook message
    console.log(JSON.stringify(body, null, 2));

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
          body.entry[0].changes[0].value.metadata.phone_number_id;
        const from = body.entry[0].changes[0].value.messages[0].from; // extract the phone number from the webhook payload
        const userWhatsappId = body.entry[0].changes[0].value.contacts[0].wa_id;
        const user = await User.findOne({ mobile: userWhatsappId }).populate(
          "insuranceDocs"
        );
        const userDocIds = user.insuranceDocs.map((userDoc) => {
          return userDoc._id.toString();
        });
        if (body.entry[0].changes[0].value.messages[0].type == "text") {
          const msg_body = body.entry[0].changes[0].value.messages[0].text.body;
          if (
            msg_body == "start" ||
            msg_body == "Start" ||
            msg_body == "change" ||
            msg_body == "Change"
          ) {
            const allUserDocs = user.insuranceDocs;
            const userOptions = [];
            allUserDocs.forEach((doc) => {
              const obj = {
                id: doc._id.toString(),
                title: doc.name,
              };
              userOptions.push(obj);
            });
            axios({
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
                    text: "Chatbot",
                  },
                  body: {
                    text: "Please specify which document you have a question about.",
                  },
                  footer: {
                    text: "To ask about another document, type 'change' or 'Change.'",
                  },
                  action: {
                    button: "Choose Document",
                    sections: [
                      {
                        rows: userOptions,
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
          } else {
            const docId = await DocumentId.find({
              userId: user._id,
              status: "Success",
            }).sort({ updatedAt: -1 });
            const answer = await this.askQuestionAboutDoc(
              "explainer",
              msg_body,
              user._id,
              docId[0].docId
            );
            axios({
              method: "POST", // Required, HTTP method, a string, e.g. POST, GET
              url:
                "https://graph.facebook.com/v18.0/" +
                phone_number_id +
                "/messages",
              data: {
                messaging_product: "whatsapp",
                to: from,
                text: { body: answer },
              },
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
            });
          }
        } else if (
          body.entry[0].changes[0].value.messages[0].type == "interactive"
        ) {
          const msg_reply =
            body.entry[0].changes[0].value.messages[0].interactive.list_reply
              .title;
          const relevantDoc = await Policy.findOne({ name: msg_reply });
          let msgToBeSent = "";
          const objectId = relevantDoc._id;
          if (userDocIds.includes(objectId.toString())) {
            msgToBeSent = "Please ask your question related to " + msg_reply;
          } else {
            msgToBeSent =
              "Invalid Document Id. Please upload your document and try again";
          }
          axios({
            method: "POST", // Required, HTTP method, a string, e.g. POST, GET
            url:
              "https://graph.facebook.com/v18.0/" +
              phone_number_id +
              "/messages",
            data: {
              messaging_product: "whatsapp",
              to: from,
              text: { body: msgToBeSent },
            },
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          });
          const existingDocId = await DocumentId.findOne({
            userId: user._id,
            docId: objectId,
          });
          if (!existingDocId) {
            const docObj = {
              docId: objectId,
              userId: user._id,
              answerFromWhatsApp: msgToBeSent,
              status: "Success",
            };
            const newDocIdentificationMsg = new DocumentId(docObj);
            await newDocIdentificationMsg.save();
          } else {
            existingDocId.updatedAt = Date.now();
            existingDocId.answerFromWhatsApp = msgToBeSent;
            await existingDocId.save();
          }
        }
      }
      return "Success";
    } else {
      // Return a '404 Not Found' if event is not from a WhatsApp API
      return "Not found";
    }
  }

  async verifyWebhook(query) {
    const myToken = process.env.MY_TOKEN;
    const mode = query["hub.mode"];
    const challenge = query["hub.challenge"];
    const token = query["hub.verify_token"];

    if (mode && token) {
      if (mode == "subscribe" && token == myToken) {
        return challenge;
      } else {
        return "Errorrrr";
      }
    }
  }

  async pushDataToPineconeIndex(index_name, documentData, userId) {
    try {
      const data = [];
      let rawData;
      if (documentData.length != undefined) {
        for (let i = 0; i < documentData.length; i++) {
          const doc = documentData[i];
          rawData = await pdfParse(doc);
          data.push(rawData.text.trim());
        }
      } else {
        rawData = await pdfParse(documentData);
        data.push(rawData.text.trim());
      }
      const index = pinecone.Index(index_name);
      const batch_size = 50;
      const finalContext = data.join(" ");
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 100,
      });
      const docs = await splitter.splitDocuments([
        new Document({ pageContent: finalContext }),
      ]);
      for (const doc of docs) {
        doc.id = Math.random()
          .toString(36)
          .substring(2, 12 + 2);
      }

      //   await User.findByIdAndUpdate(userId, { $set: { insuranceDocs: docs } });
      const policyObj = {
        insuranceDocs: docs.map((doc) => {
          const obj = {
            id: doc.id,
            metadata: doc.metadata,
          };
          return obj;
        }),
      };
      const newPolicy = new Policy(policyObj);
      await newPolicy.save();

      for (let i = 0; i < docs.length; i += batch_size) {
        const i_end = Math.min(docs.length, i + batch_size);
        const meta_batch = docs.slice(i, i_end);
        const ids_batch = meta_batch.map((x) => x.id);
        const texts_batch = meta_batch.map((x) => x.pageContent);
        let response;
        try {
          response = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: texts_batch,
          });
        } catch (error) {
          const done = false;
          while (!done) {
            await this.sleep(5);
            try {
              response = await openai.createEmbedding({
                model: "text-embedding-ada-002",
                input: texts_batch,
              });
            } catch (error) {
              console.log(error.message);
            }
          }
        }
        const embeds = response.data.data.map((record) => record.embedding);
        const meta_batch_cleaned = meta_batch.map((x) => ({
          pageContent: x.pageContent,
          policyId: newPolicy._id,
        }));
        const to_upsert = ids_batch.map((id, i) => ({
          id: id,
          values: embeds[i],
          metadata: meta_batch_cleaned[i],
        }));
        // const upsertRequest = {
        //   vectors: to_upsert,
        //   namespace: namespace,
        // };
        // console.log(upsertRequest.vectors[0])
        await index.upsert(to_upsert);
        console.log("Uploaded");
      }
      newPolicy.status = "Uploaded to Pinecone";
      await newPolicy.save();
      await User.findByIdAndUpdate(userId, {
        $push: { insuranceDocs: newPolicy._id },
      });
      return "Successfully Uploaded";
    } catch (err) {
      console.log("Error in pushDataToPinecone function :: err", err.message);
      throw new Error(err);
    }
  }

  async askQuestionAboutDoc(indexName, question, userId, insuranceDocId) {
    const user = await User.findById(userId);
    if (user.insuranceDocs.includes(insuranceDocId)) {
      const qnaObj = {
        question: question,
        userId: userId,
        insuranceDocs: insuranceDocId,
      };
      const newQuestion = new QnA(qnaObj);
      await newQuestion.save();
      const index = pinecone.Index(indexName);
      let response = await openai.createEmbedding({
        model: "text-embedding-ada-002",
        input: question,
      });
      const xq = response.data.data[0].embedding;
      response = await index.query({
        vector: xq,
        filter: { policyId: insuranceDocId.toString() },
        topK: 2,
        includeMetadata: true,
        // includeValues: true
      });
      const contexts = response.matches.map(
        (match) => match.metadata.pageContent
      );
      // const scores = response.matches.map((match) => match.score)

      const answer = await this.askChatGPT(contexts, question);
      newQuestion.gptLogs = answer;
      newQuestion.answer = answer.choices[0].message.content;
      await newQuestion.save();
      // return newQuestion;
      return newQuestion.answer;
    }
    return "User does not have such a policy";
  }

  async askChatGPT(question, context) {
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "Answer the question based on the context below",
        },
        {
          role: "user",
          content: `Context: ${context}
                      Question: ${question}`,
        },
        {
          role: "assistant",
          content: "Answer: ",
        },
      ],
    });
    return response.data;
  }
}

module.exports = new PineconeChatbot();
