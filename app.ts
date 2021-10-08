import express, { Request, Response, NextFunction } from "express";
import { MongoClient } from "mongodb";
import cacheManager from "cache-manager";
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
client
  .connect()
  .then(() => {
    console.log("Mongo connected");
  })
  .catch((err) => {
    console.log("Mongo connection error:", err);
  });
const db = client.db();
const employeeCollection = db.collection("employee");
// }}}

// cache init {{{
const cache = cacheManager.caching({
  store: "memory",
  max: 100,
  ttl: 600 /*seconds*/,
});
// }}}

// routes
app.get("/", (_: Request, res: Response) => {
  res.send("Welcome to Orange Skill API");
});

// ---- types ----
class Skill {
  constructor(
    public skillId: number,
    public managerId: number,
    public track: string,
    public trackDetails: string,
    public profiency: number,
    public levelOne: string,
    public levelTwo: string,
    public levelThree: string,
    public levelFour: string,
    public levelOthers: string
  ) {
    this.skillId = Number(skillId);
    this.managerId = Number(managerId);
    this.profiency = Number(profiency);
  }
}

interface ISkill extends Skill {}

class SkillDb extends Skill {
  constructor(
    public skillId: number,
    public managerId: number,
    public track: string,
    public trackDetails: string,
    public profiency: number,
    public levelOne: string,
    public levelTwo: string,
    public levelThree: string,
    public levelFour: string,
    public levelOthers: string,
    public confirmed: boolean,
    public public_: boolean,
    public comments: IComment[]
  ) {
    super(
      skillId,
      managerId,
      track,
      trackDetails,
      profiency,
      levelOne,
      levelTwo,
      levelThree,
      levelFour,
      levelOthers
    );
  }
}

interface ISkillDb extends SkillDb {}

class Comment {
  constructor(
    public message: string,
    public sender: string,
    public senderId: number,
    public newProficiency: number
  ) {}
}

interface IComment extends Comment {}

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
app.post("/employee/add", async (req: Request, res: Response) => {
  const body = req.body;
  const empId: number = body.empId;
  const newDoc = body;
  newDoc._id = empId;

  try {
    const doc = await employeeCollection.insertOne(newDoc);
    res.send({ msg: "success", data: doc });
  } catch (err) {
    res.status(400).send({ msg: "error", error: err, errString: "" + err });
  }
});

app.post("/employee/get", async (req: Request, res: Response) => {
  const body = req.body;
  const empId: number = body.empId;

  try {
    const doc = await employeeCollection.findOne({ _id: empId });
    res.send({ msg: "success", data: doc });
  } catch (err) {
    res.status(400).send({ msg: "error", error: err, errString: "" + err });
  }
});

// ---- employee-skill endpoints -----
async function addEmployeeSkillBlockchain(empId: number, skill: Skill) {
  const tx = contract.methods.addSkill(
    empId,
    skill.skillId,
    skill.managerId,
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

  return ret;
}

async function findManagerIdFromEmail(email: string): Promise<number> {
  const doc = await employeeCollection.findOne({ email: email });
  return doc.empId;
}

// adds to DB only
app.post("/employee/skill/add", async (req: Request, res: Response) => {
  const body = req.body;
  const rawSkill: any = body.skill;
  const empId: number = body.empId;

  rawSkill.confirmed = false;
  rawSkill.comments = [];

  const managerId = await findManagerIdFromEmail(rawSkill.managerEmail);
  rawSkill.managerId = managerId;
  delete rawSkill.managerEmail;

  const skill: ISkillDb = rawSkill;

  const updateRes = await employeeCollection.updateOne(
    { _id: empId },
    { $push: { skills: skill } }
  );
  console.log(updateRes);

  cache.del(empId.toString());

  res.send({ msg: "success", db: updateRes });
});

// comment on the skill
app.post("/employee/skill/comment", async (req: Request, res: Response) => {
  const body = req.body;
  const skillIdx: number = body.skillIdx;
  const empId: number = body.empId;
  const comment: IComment = body.comment;

  const updateRes = await employeeCollection.updateOne(
    {
      _id: empId,
    },
    {
      $push: { [`skills.${skillIdx}.comments`]: comment },
    }
  );

  res.send({ msg: "success", updateRes });
});

// confirms skill and adds to blockchain
app.post("/employee/skill/confirm", async (req: Request, res: Response) => {
  const body = req.body;
  const skillIdx: number = body.skillIdx;
  const empId: number = body.empId;

  if (skillIdx === null || skillIdx === undefined) {
    res.status(400).send("skillIdx missing");
  }
  if (empId === null || empId === undefined) {
    res.status(400).send("empId missing");
  }

  const updateRes = await employeeCollection.updateOne(
    { _id: empId },
    { $set: { [`skills.${skillIdx}.confirmed`]: true } }
  );

  const emp = await employeeCollection.findOne(
    {
      _id: empId,
    },
    {
      projection: {
        skills: { $slice: [skillIdx, 1] },
      },
    }
  );
  const skill = emp.skills[0];

  const ret = await addEmployeeSkillBlockchain(empId, skill as Skill);

  cache.del(empId.toString());

  res.send({ msg: "success", updateRes, blockchain: ret });
});

async function getSkillsFromBlockchain(empId: number) {
  // result is array of array here
  const result: any[][] = await contract.methods.getSkills(empId).call();

  const skills: Skill[] = [];
  result.forEach((arr: Tuple<any, 11>) => {
    // console.log(arr);
    ((_: any, ...arr: Tuple<any, 10>) => {
      skills.push(new Skill(...arr));
    })(...arr);
  });

  return skills;
}

async function getSkillsFromBlockchainCached(empId: number): Promise<Skill[]> {
  console.log("trying cache (for blockchain)");
  return await cache.wrap(empId.toString(), () => {
    console.log("cache miss (for blockchain)");
    return getSkillsFromBlockchain(empId);
  });
}

app.post("/employee/skills", async (req: Request, res: Response) => {
  const body = req.body;
  const empId: number = body.empId;

  const skills: Skill[] = await getSkillsFromBlockchain(empId);

  res.send({ skills });
});

async function searchSkill(empId: number, skills: Skill[], rawQuery: string) {
  const query = rawQuery.toLowerCase();

  const foundSkills: Skill[] = [];

  for (const skill of skills) {
    if (
      skill.levelOne.toLowerCase().includes(query) ||
      skill.levelTwo.toLowerCase().includes(query) ||
      skill.levelThree.toLowerCase().includes(query) ||
      skill.levelFour.toLowerCase().includes(query) ||
      skill.levelOthers.toLowerCase().includes(query)
    ) {
      foundSkills.push(skill);
    }
  }

  if (foundSkills.length == 0) return null;
  else {
    return { empId, foundSkills };
  }
}

async function searchSkillCached(
  empId: number,
  skills: Skill[],
  rawQuery: string
) {
  console.log("trying cache (for computation)");
  return await cache.wrap(rawQuery + ";-;-;" + empId.toString(), () => {
    console.log("cache miss (for blockchain)");
    return searchSkill(empId, skills, rawQuery);
  });
}

app.post("/employee/searchSkill", async (req: Request, res: Response) => {
  const body = req.body;

  const query: string = body.query;

  const results = await employeeCollection
    .find({})
    .project({ _id: 1 })
    .toArray();

  const promises: Promise<any>[] = [];
  results.forEach((result) => {
    promises.push(
      (async () => {
        return await searchSkillCached(
          result._id,
          await getSkillsFromBlockchainCached(result._id),
          query
        );
      })()
    );
  });

  const empIds = await Promise.all(promises);
  // empIds includes some null values, remove those
  const newEmpIds = empIds.filter((e) => e);

  console.log(newEmpIds);

  res.send({ searchResult: newEmpIds });
});

// listen
app.listen(port, () => {
  console.log(`Orange Identity API is running on port ${port}.`);
});
