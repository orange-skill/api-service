import express, { Request, Response, NextFunction } from "express";
import { MongoClient, ObjectId } from "mongodb";
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
const skillsCollection = db.collection("skillsList");
const searchCollection = db.collection("searches");
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
    public comments: IComment[],
    public createdAt: Date,
    public confirmedAt: Date
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
    public newProficiency: number,
    public createdAt: Date
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

// ---- admin endpoints ----

app.post("/admin/user/approve", async (req: Request, res: Response) => {
  const empId: number = req.body.empId;

  try {
    const doc = await employeeCollection.updateOne(
      { _id: empId },
      { $set: { verified: 1 } }
    );
    res.send({ msg: "success", data: doc });
  } catch (err) {
    res.status(400).send({ msg: "error", error: err, errString: "" + err });
  }
});

app.post("/admin/user/reject", async (req: Request, res: Response) => {
  const empId: number = req.body.empId;

  try {
    const doc = await employeeCollection.updateOne(
      { _id: empId },
      { $set: { verified: -1 } }
    );
    res.send({ msg: "success", data: doc });
  } catch (err) {
    res.status(400).send({ msg: "error", error: err, errString: "" + err });
  }
});

app.get("/admin/user/all", async (_: Request, res: Response) => {
  try {
    const doc = await employeeCollection.find().toArray();
    res.send({ msg: "success", data: doc });
  } catch (err) {
    res.status(400).send({ msg: "error", error: err, errString: "" + err });
  }
});

// ---- employee endpoint        -----
app.post("/employee/add", async (req: Request, res: Response) => {
  const body = req.body;
  const empId: number = body.empId;
  const newDoc = body;
  newDoc._id = empId;

  if (newDoc.verified === undefined || newDoc.verified === null) {
    newDoc.verified = 0;
  }

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

app.get("/employee/getByEmail", async (req: Request, res: Response) => {
  const empEmail: string = req.query.email as string;

  try {
    console.log("Looking for employee with email", empEmail);
    const empId = await findManagerIdFromEmail(empEmail);
    const doc = await employeeCollection.findOne({ _id: empId });
    res.send({ msg: "success", data: doc });
  } catch (err) {
    res.status(400).send({ msg: "error", error: err, errString: "" + err });
  }
});

// ---- employee-skill endpoints -----
app.post("/employee/skill/meta", async (_: Request, res: Response) => {
  const doc = await skillsCollection.findOne({
    _id: new ObjectId("000000000000000000000001"),
  });
  res.send(doc.data);
});

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
  const doc = await employeeCollection.findOne({
    email: { $exists: true, $eq: email },
  });
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
  skill.createdAt = new Date();
  skill.confirmedAt = new Date(0);

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
  comment.createdAt = new Date();

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
    {
      $set: {
        [`skills.${skillIdx}.confirmed`]: true,
        [`skills.${skillIdx}.confirmedAt`]: new Date(),
      },
    }
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

app.post("/manager/getPendingSkills", async (req: Request, res: Response) => {
  const managerId = req.body.managerId;
  console.log("Getting pending skills for manager", managerId);

  try {
    const docs = await employeeCollection
      .find({
        skills: { $elemMatch: { managerId: managerId, confirmed: false } },
      })
      .toArray();
    docs.forEach((doc) => {
      doc.skills = (doc.skills as SkillDb[]).filter((skill) => {
        if (skill.managerId === managerId && skill.confirmed === false)
          return true;
        return false;
      });
    });

    // const docs = await employeeCollection
    //   .aggregate([
    //     {
    //       $match: { "skills.managerId": managerId, "skills.confirmed": false },
    //     },
    //     { $unwind: "$skills" },
    //     {
    //       $match: { "skills.managerId": managerId, "skills.confirmed": false },
    //     },
    //     { $project: { skills: 1 } },
    //     {
    //       $group: {
    //         // group all documents
    //         _id: null, // into the same bucket
    //         skills: { $push: "$skills" }, // and push every image entry into an array called "images"
    //       },
    //     },
    //     {
    //       $project: {
    //         _id: 0, // to get rid of the "_id" field if needed
    //       },
    //     },
    //   ])
    //   .toArray();
    employeeCollection.aggregate();
    res.send({ msg: "success", data: docs });
  } catch (err) {
    res.status(400).send({ msg: "error", error: err, errString: "" + err });
  }
});

async function searchSkill(
  empId: number,
  skills: Skill[],
  rawQuery: string,
  sortByProf: boolean
) {
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

  let maxProficiency = 0;
  foundSkills.forEach((el) => {
    if (el.profiency > maxProficiency) {
      maxProficiency = el.profiency;
    }
  });

  if (sortByProf) {
    foundSkills.sort((first, second) => {
      if (first.profiency < second.profiency) {
        return 1;
      } else if (first.profiency > second.profiency) {
        return -1;
      } else {
        return 0;
      }
    });
  }

  if (foundSkills.length == 0) return null;
  else {
    return { empId, foundSkills, maxProficiency };
  }
}

async function searchSkillCached(
  empId: number,
  skills: Skill[],
  rawQuery: string,
  sortByProf: boolean
) {
  console.log("trying cache (for computation)");
  return await cache.wrap(
    rawQuery + ";-;-;" + empId.toString(),
    () => {
      console.log("cache miss (for blockchain)");
      return searchSkill(empId, skills, rawQuery, sortByProf);
    },
    { ttl: 0 }
  );
}

function formatDate(date: Date) {
  // return ('0' + date.getUTCDate()).slice(-2) + "-" + ('0' + (date.getUTCMonth()+1)).slice(-2) + date.getUTCFullYear();
  return date.toLocaleDateString("en-GB", {
    // you can use undefined as first argument
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function logSearch(query: string, loc: string, givenDate: string = null) {
  query = query.toLowerCase();

  let date: Date;
  if (givenDate === null || givenDate === undefined) {
    date = new Date(Date.now());
  } else {
    date = new Date(givenDate);
  }

  const dateStr = formatDate(date);

  console.log(
    `Storing search query "${query} at date ${dateStr} in location ${loc}"`
  );

  const res = await searchCollection.updateOne(
    { date: dateStr, loc: loc, query: query },
    { $inc: { count: 1 } },
    { upsert: true }
  );

  return res;
}

app.post("/employee/searchSkill", async (req: Request, res: Response) => {
  const body = req.body;

  const query: string = body.query;
  const loc: string = body.loc;
  const givenDate = body.date;
  let sortByProf = false;
  if (body.sortByProf) {
    sortByProf = true;
  }

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
          query,
          sortByProf
        );
      })()
    );
  });

  const empIds = await Promise.all(promises);
  // empIds includes some null values, remove those
  const newEmpIds = empIds.filter((e) => e);

  if (sortByProf) {
    newEmpIds.sort((first, second) => {
      if (first.maxProficiency < second.maxProficiency) {
        return 1;
      } else if (first.maxProficiency > second.maxProficiency) {
        return -1;
      } else {
        return 0;
      }
    });
  }

  console.log(newEmpIds);

  await logSearch(query, loc, givenDate);

  res.send({ searchResult: newEmpIds });
});

app.post(
  "/employee/search/analytics/date",
  async (req: Request, res: Response) => {
    const result = searchCollection.aggregate([
      // { $group: { _id: "$query", date: { $first: "$date" } } },
      // { $group: { _id: "$date", count: { $sum: 1 } } },
      // ref: https://stackoverflow.com/a/22935461/11199009
      {
        $group: {
          _id: {
            date: "$date",
            query: "$query",
          },
          count: { $sum: "$count" },
        },
      },
      { $sort: { "_id.date": 1 } },
      {
        $group: {
          _id: "$_id.query",
          dates: {
            $push: {
              date: "$_id.date",
              count: "$count",
            },
          },
          count: { $sum: "$count" },
        },
      },
      { $sort: { count: -1 } },
      // {
      //   $project: {
      //     dates: { $slice: ["$dates", 2] },
      //     count: 1,
      //   },
      // },
    ]);
    const counts = await result.toArray();

    res.send({ counts });
  }
);

app.post(
  "/employee/search/analytics/loc",
  async (req: Request, res: Response) => {
    const result = searchCollection.aggregate([
      {
        $group: {
          _id: {
            loc: "$loc",
            query: "$query",
          },
          count: { $sum: "$count" },
        },
      },
      { $sort: { count: -1 } },
      {
        $group: {
          _id: "$_id.query",
          locs: {
            $push: {
              loc: "$_id.loc",
              count: "$count",
            },
          },
          count: { $sum: "$count" },
        },
      },
      { $sort: { count: -1 } },
      // {
      //   $project: {
      //     locs: { $slice: ["$locs", 2] },
      //     count: 1,
      //   },
      // },
    ]);
    const counts = await result.toArray();

    res.send({ counts });
  }
);

// listen
app.listen(port, () => {
  console.log(`Orange Identity API is running on port ${port}.`);
});
