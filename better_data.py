import sys
from pprint import pprint
import json
from typing import cast
from random import randint

import pandas as pd

filename = sys.argv[1]
if filename.endswith("xlsx"):
    df: pd.DataFrame = pd.read_excel(filename, sheet_name="SkillMaster")
elif filename.endswith("csv"):
    df: pd.DataFrame = cast(pd.DataFrame, pd.read_csv(filename, names=[f"Level {num}" for num in range(1, 5)]))
else:
    raise Exception("wrong file type.")

print(df)


def recur(df, num: int):
    if num == 4:
        # print("level 4", df)
        return [{"name": skill, "_id": randint(0, 10000)} for skill in df["Level 4"].tolist()]

    groups = df.groupby(f"Level {num}")

    ret = {}

    for name, group in groups:
        # print(name, group)
        ret[name] = recur(group, num + 1)

    return ret


out = recur(df, 1)

pprint(out)

with open("./skill_data.json", "wt", encoding="utf-8") as f:
    json.dump(out, f, indent=4, ensure_ascii=False)
