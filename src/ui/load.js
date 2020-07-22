// @flow
import * as pluginId from "../api/pluginId";
import {CredView} from "../analysis/credView";
import {fromJSON as credResultFromJSON} from "../analysis/credResult";

export type LoadResult = LoadSuccess | LoadFailure;
export type LoadSuccess = {|
  +type: "SUCCESS",
  +credView: CredView,
  +bundledPlugins: $ReadOnlyArray<pluginId.PluginId>,
|};
export type LoadFailure = {|+type: "FAILURE", +error: any|};

export async function load(): Promise<LoadResult> {
  const queries = [fetch("output/credResult.json"), fetch("/sourcecred.json")];
  const responses = await Promise.all(queries);

  for (const response of responses) {
    if (!response.ok) {
      console.error(response);
      return {type: "FAILURE", error: response.status};
    }
  }
  try {
    const json = await responses[0].json();
    const credResult = credResultFromJSON(json);
    const credView = new CredView(credResult);
    const {bundledPlugins} = await responses[1].json();
    return {type: "SUCCESS", credView, bundledPlugins};
  } catch (e) {
    console.error(e);
    return {type: "FAILURE", error: e};
  }
}