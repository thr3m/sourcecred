// @flow

import React from "react";
import {OdysseyInstance} from "./instance";
import {OdysseyApp} from "./ui/App";
import {GraphVisualizer, type Node} from "../../visualizer/GraphVisualizer";
import {type NodeAddressT, type Edge} from "../../core/graph";
import {PagerankGraph} from "../../core/pagerankGraph";
import * as NullUtil from "../../util/null";

export type Props = {|
  +instance: OdysseyInstance,
|};

export type State = {|
  pagerankGraph: PagerankGraph,
  nodes: $ReadOnlyArray<Node>,
  edges: $ReadOnlyArray<Edge>,
  selectedNode: NodeAddressT | null,
|};

export class OdysseyInstanceVisualizer extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const {instance} = props;
    const edgeEvaluator = (_unused_edge) => ({toWeight: 1, froWeight: 0.3});
    const pagerankGraph = new PagerankGraph(instance.graph(), edgeEvaluator);
    const {nodes, edges} = computeNodesAndEdges(instance, pagerankGraph);
    this.state = {pagerankGraph, selectedNode: null, nodes, edges};
  }

  async componentDidMount() {
    await this.state.pagerankGraph.runPagerank();
    const {nodes, edges} = computeNodesAndEdges(
      this.props.instance,
      this.state.pagerankGraph
    );
    this.setState({nodes, edges});
  }

  render() {
    const sidebars = [
      {type: "VALUE", title: "Values"},
      {type: "PERSON", title: "People"},
      {type: "ARTIFACT", title: "Artifacts"},
    ];
    return (
      <OdysseyApp
        sidebarDeclarations={sidebars}
        nodes={this.state.nodes}
        edges={this.state.edges}
        instanceName={this.props.instance.name()}
      />
    );
  }
}

function computeNodesAndEdges(
  instance: OdysseyInstance,
  pagerankGraph: PagerankGraph
) {
  const rawNodes = Array.from(instance.nodes());
  const scores = rawNodes.map(
    ({address}) => NullUtil.get(pagerankGraph.node(address)).score * 1000
  );
  const maxScore = Math.max(...scores);
  const nodes: $ReadOnlyArray<Node> = rawNodes.map(
    ({nodeTypeIdentifier, address, description}, i) => ({
      address,
      type: nodeTypeIdentifier,
      score: scores[i],
      scoreRatio: scores[i] / maxScore,
      description,
    })
  );
  const edges: $ReadOnlyArray<Edge> = Array.from(instance.graph().edges());
  return {nodes, edges};
}