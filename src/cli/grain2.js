// @flow

import fs from "fs-extra";
import {join} from "path";
import {loadFileWithDefault, loadJson} from "../util/disk";
import {Ledger} from "../core/ledger/ledger";
import {applyDistributions2} from "../core/ledger/applyDistributions";
import {computeCredAccounts2} from "../core/ledger/credAccounts";
import stringify from "json-stable-stringify";
import * as G from "../core/ledger/grain";
import dedent from "../util/dedent";
import {loadCredGraph} from "./common";

import * as GrainConfig from "../api/grainConfig";
import type {Command} from "./command";

function die(std, message) {
  std.err("fatal: " + message);
  return 1;
}

const grain2Command: Command = async (args, std) => {
  let simulation = false;
  if (args.length === 1 && (args[0] === "--simulation" || args[0] === "-s")) {
    simulation = true;
  } else if (args.length !== 0) {
    return die(std, "usage: sourcecred grain2 [--simulation]");
  }

  const baseDir = process.cwd();
  const grainConfigPath = join(baseDir, "config", "grain.json");
  const grainConfig = await loadJson(grainConfigPath, GrainConfig.parser);
  const distributionPolicy = GrainConfig.toDistributionPolicy(grainConfig);

  const ledgerPath = join(baseDir, "data", "ledger.json");
  const ledger = Ledger.parse(
    await loadFileWithDefault(ledgerPath, () => new Ledger().serialize())
  );

  const credGraph = await loadCredGraph(baseDir);

  const distributions = applyDistributions2(
    distributionPolicy,
    credGraph,
    ledger,
    +Date.now()
  );

  let totalDistributed = G.ZERO;
  const recipientIdentities = new Set();
  for (const {allocations} of distributions) {
    for (const {receipts} of allocations) {
      for (const {amount, id} of receipts) {
        totalDistributed = G.add(amount, totalDistributed);
        recipientIdentities.add(id);
      }
    }
  }

  console.log(
    simulation ? `——SIMULATED DISTRIBUTION——\n` : ``,
    `Distributed ${G.format(totalDistributed)} to ${
      recipientIdentities.size
    } identities in ${distributions.length} distributions`
  );

  if (!simulation) {
    await fs.writeFile(ledgerPath, ledger.serialize());

    const credAccounts = computeCredAccounts2(ledger, credGraph);
    const accountsPath = join(baseDir, "output", "accounts.json");
    await fs.writeFile(accountsPath, stringify(credAccounts));
  }

  return 0;
};

export const grain2Help: Command = async (args, std) => {
  std.out(
    dedent`\
      usage: sourcecred grain2 [--simulation || -s]

      Distribute Grain (or whatever currency this Cred instance is tracking)
      for Cred intervals in which Grain was not already distributed.

      When the '--simulation' (-s) flag is provided, no grain will actually be distributed,
      allowing for testing the output of various configurations.

      When run, this will identify all the completed Cred intervals (currently, weeks)
      and find the latest Cred interval for which there was no Grain distribution.
      Then, it will distribute Grain for all of them, making a corresponding change
      to the Ledger. This could result in zero or more distributions, depending on how
      many recent Cred intervals had no corresponding Grain distribution.

      Grain is distributed based on the configuration in the config/grain.json
      file. The fields are as follows:

      immediatePerWeek: The amount of grain to distribute for activity in the most
      recent period. (value type: integer)

      balancedPerWeek: The amount of grain to distribute according to all-time cred
      scores. (value type: integer)

      maxSimultaneousDistributions: The maximum number of distributions to create in
      a single 'sourcecred grain' call if distributions have been missed. If set to
      1, then the command will create at most one distribution. If unset, defaults
      to Infinity.
      (value type: integer)
      `.trimRight()
  );
  return 0;
};

export default grain2Command;
