import express, { Request, Response, NextFunction } from "express";
import { ObjectId, MongoClient } from "mongodb";
import cors from "cors";
import Web3 from "web3";
import dotenv from "dotenv";

// express init
const app = express();
const port = 3001;
// middle wares
app.use(express.json());
app.use(cors());

// web3 init
dotenv.config();
const web3 = new Web3("http://localhost:8545");
const privateKey = process.env.PRIVATE_KEY;
const jsonInterface = JSON.parse(
  Buffer.from(process.env.CONTRACT_JSON_ABI, "base64").toString()
);
// console.log(jsonInterface);
// console.log(JSON.stringify(jsonInterface, null, 4));
const contractAddress = process.env.CONTRACT_ADDRESS;
const account = web3.eth.accounts.privateKeyToAccount("0x" + privateKey);
const contract = new web3.eth.Contract(jsonInterface, contractAddress, {
  gasPrice: "0",
  from: account.address,
});

// DB init {{{
const client = new MongoClient(process.env.DB_CONN_STRING);
client.connect().then(() => {
  console.log("Mongo connected");
}).catch(err => {
  console.log("Mongo connection error:", err);
});
const db = client.db();
const employeeCollection = db.collection("employee");
// }}}

// routes
app.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Welcome to Orange Skill API");
});

// ---- types ----
interface ISkill extends Skill {}

class Skill {
  constructor(
    public skillId: number,
    public track: string,
    public trackDetails: string,
    public profiency: number,
    public levelOne: string,
    public levelTwo: string,
    public levelThree: string,
    public levelFour: string,
    public levelOthers: string
  ) {}
}

// source: https://stackoverflow.com/a/52490977/11199009
type Tuple<T, N extends number> = N extends N
  ? number extends N
    ? T[]
    : _TupleOf<T, N, []>
  : never;
type _TupleOf<T, N extends number, R extends unknown[]> = R["length"] extends N
  ? R
  : _TupleOf<T, N, [T, ...R]>;

// ---- employee endpoint        -----
app.post(
  "/employee/add",
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body;
    const empId: number = body.empId;
    const newDoc = body;
    newDoc._id = empId;

    try {
      const doc = await employeeCollection.insertOne(newDoc);
      res.send({"msg": "success", data: doc});
    } catch (err) {
      res.status(400).send({"msg": "error", "error": err, "errString": "" + err});
    }

});
app.post(
  "/employee/get",
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body;
    const empId: number = body.empId;

    try {
      const doc = await employeeCollection.findOne({_id: empId});
      res.send({"msg": "success", data: doc});
    } catch (err) {
      res.status(400).send({"msg": "error", "error": err, "errString": "" + err});
    }

});

// ---- employee-skill endpoints -----
app.post(
  "/employee/skill/add",
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body;
    const skill: ISkill = body.skill;
    const empId: number = body.empId;

    const tx = contract.methods.addSkill(
      empId,
      skill.skillId,
      skill.track,
      skill.trackDetails,
      skill.profiency,
      skill.levelOne,
      skill.levelTwo,
      skill.levelThree,
      skill.levelFour,
      skill.levelOthers
    );

    const newTx = {
      from: account.address,
      to: contractAddress,
      gas: "0x100000",
      data: tx.encodeABI(),
    };

    // console.log("Transaction: ", newTx);
    const signedTx = await account.signTransaction(newTx);
    // console.log("signed transaction: ", signedTx.rawTransaction);
    const result = web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    // result
    //   .on("receipt", function (receipt) {
    //     console.log("Receipt:", receipt);
    //   })
    //   .on("error", (err) => {
    //     console.log("Error calling method", err);
    //   });

    let ret = {};
    try {
      const receipt = await result;
      console.log("Receipt", receipt);
      ret = {
        msg: "Added to blockchain successfully",
        receipt: receipt,
      };
    } catch (err) {
      console.log("Error calling method", err);
      ret = {
        msg: "Error adding to blockchain",
        error: err,
      };
    }

    const updateRes = await employeeCollection.updateOne({_id: empId}, {"$push": {"skills": skill}});
    console.log(updateRes);

    res.send({"blockchain": ret, "db": updateRes});
  }
);

app.post(
  "/employee/skills",
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body;
    const empId: number = body.empId;

    // result is array of array here
    const result: any[][] = await contract.methods.getSkills(empId).call();

    const skills: Skill[] = [];
    result.forEach((arr: Tuple<any, 9>) => {
      skills.push(new Skill(...arr));
    });

    res.send({ skills });
  }
);

// listen
app.listen(port, () => {
  console.log(`Orange Identity API is running on port ${port}.`);
});
