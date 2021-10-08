import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { readFileSync } from "fs";

dotenv.config();
// DB init {{{
const client = new MongoClient(process.env.DB_CONN_STRING);
client
  .connect()
  .then(() => {
    console.log("Mongo connected");
  })
  .catch((err) => {
    console.log("Mongo connection error:", err);
  });
const db = client.db();
// }}}
//
const skillsCollection = db.collection("skillsList");

const records = require("./skill_data.json")

console.log("got records", records);

const doc = skillsCollection.insertOne({ _id: new ObjectId("000000000000000000000001"), data: records }).then((res) => {
  console.log("done", res);
  client.close();
});
console.log(doc)

