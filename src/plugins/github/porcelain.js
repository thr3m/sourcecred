// @flow

/*
 * This module contains "Porcelain" for working with GitHub graphs. By
 * "Porcelain", we mean it is a much more convenient and polished API. It
 * allows accessing GitHub graph data via a familiar object-oriented API,
 * rather than needing to use the specific graph-based methods in the
 * underlying graph.
 *
 * In general, the porcelain module provides wrapper objects that contain the
 * entire GitHub graph, and a pointer to a particular entity in that graph.
 * Creating the wrappers is extremely cheap; all actual computation (e.g.
 * finding the body or author of a post) is done lazily when that information
 * is requested.
 */
import stringify from "json-stable-stringify";

import {Graph} from "../../core/graph";
import type {Node} from "../../core/graph";
import type {Address} from "../../core/address";
import type {
  AuthorNodePayload,
  AuthorSubtype,
  CommentNodePayload,
  EdgePayload,
  IssueNodePayload,
  MergedAsEdgePayload,
  NodePayload,
  NodeType,
  PullRequestNodePayload,
  PullRequestReviewCommentNodePayload,
  PullRequestReviewNodePayload,
  PullRequestReviewState,
  RepositoryNodePayload,
} from "./types";

import {
  AUTHORS_EDGE_TYPE,
  AUTHOR_NODE_TYPE,
  COMMENT_NODE_TYPE,
  CONTAINS_EDGE_TYPE,
  ISSUE_NODE_TYPE,
  MERGED_AS_EDGE_TYPE,
  PULL_REQUEST_NODE_TYPE,
  PULL_REQUEST_REVIEW_COMMENT_NODE_TYPE,
  PULL_REQUEST_REVIEW_NODE_TYPE,
  REPOSITORY_NODE_TYPE,
  REFERENCES_EDGE_TYPE,
} from "./types";

import {PLUGIN_NAME} from "./pluginName";

import {COMMIT_NODE_TYPE} from "../git/types";

export type Entity =
  | Repository
  | Issue
  | PullRequest
  | Comment
  | Author
  | PullRequestReview
  | PullRequestReviewComment;

function assertEntityType(e: Entity, t: NodeType) {
  if (e.type() !== t) {
    throw new Error(
      `Expected entity at ${stringify(e.address())} to have type ${t}`
    );
  }
}

export function asEntity(
  g: Graph<NodePayload, EdgePayload>,
  addr: Address
): Entity {
  const type: NodeType = (addr.type: any);
  if (addr.pluginName !== PLUGIN_NAME) {
    throw new Error(
      `Tried to make GitHub porcelain, but got the wrong plugin name: ${stringify(
        addr
      )}`
    );
  }
  switch (type) {
    case "ISSUE":
      return new Issue(g, addr);
    case "PULL_REQUEST":
      return new PullRequest(g, addr);
    case "COMMENT":
      return new Comment(g, addr);
    case "AUTHOR":
      return new Author(g, addr);
    case "PULL_REQUEST_REVIEW":
      return new PullRequestReview(g, addr);
    case "PULL_REQUEST_REVIEW_COMMENT":
      return new PullRequestReviewComment(g, addr);
    case "REPOSITORY":
      return new Repository(g, addr);
    default:
      // eslint-disable-next-line no-unused-expressions
      (type: empty);
      throw new Error(
        `Tried to make GitHub porcelain, but got invalid type: ${stringify(
          addr
        )}`
      );
  }
}

export class Porcelain {
  graph: Graph<NodePayload, EdgePayload>;

  constructor(graph: Graph<NodePayload, EdgePayload>) {
    this.graph = graph;
  }

  /* Return all the repositories in the graph */
  repositories(): Repository[] {
    return this.graph
      .nodes({type: REPOSITORY_NODE_TYPE})
      .map((n) => new Repository(this.graph, n.address));
  }

  /* Return the repository with the given owner and name */
  repository(owner: string, name: string): Repository {
    const repo = this.repositories().filter(
      (r) => r.owner() === owner && r.name() === name
    );
    if (repo.length > 1) {
      throw new Error(
        `Unexpectedly found multiple repositories named ${owner}/${name}`
      );
    }
    return repo[0];
  }
}

class GithubEntity<T: NodePayload> {
  graph: Graph<NodePayload, EdgePayload>;
  nodeAddress: Address;

  constructor(graph: Graph<NodePayload, EdgePayload>, nodeAddress: Address) {
    this.graph = graph;
    this.nodeAddress = nodeAddress;
  }

  node(): Node<T> {
    return (this.graph.node(this.nodeAddress): Node<any>);
  }

  url(): string {
    return this.node().payload.url;
  }

  type(): NodeType {
    return (this.nodeAddress.type: any);
  }

  address(): Address {
    return this.nodeAddress;
  }
}

export class Repository extends GithubEntity<RepositoryNodePayload> {
  // TODO: Now that the Repository is a node in the graph, re-write methods
  // that find issues and PRs to find neighbors of the repository rather than
  // any matching nodes in the graph. Then, behavior will be correct in the
  // case where we have multiple repositories in the same graph.
  issueOrPRByNumber(number: number): ?(Issue | PullRequest) {
    let result: Issue | PullRequest;
    this.graph.nodes({type: ISSUE_NODE_TYPE}).forEach((n) => {
      if (n.payload.number === number) {
        result = new Issue(this.graph, n.address);
      }
    });
    this.graph.nodes({type: PULL_REQUEST_NODE_TYPE}).forEach((n) => {
      if (n.payload.number === number) {
        result = new PullRequest(this.graph, n.address);
      }
    });
    return result;
  }

  owner(): string {
    return this.node().payload.owner;
  }

  name(): string {
    return this.node().payload.name;
  }

  issues(): Issue[] {
    return this.graph
      .nodes({type: ISSUE_NODE_TYPE})
      .map((n) => new Issue(this.graph, n.address));
  }

  pullRequests(): PullRequest[] {
    return this.graph
      .nodes({type: PULL_REQUEST_NODE_TYPE})
      .map((n) => new PullRequest(this.graph, n.address));
  }

  authors(): Author[] {
    return this.graph
      .nodes({type: AUTHOR_NODE_TYPE})
      .map((n) => new Author(this.graph, n.address));
  }
}

class Post<
  T:
    | IssueNodePayload
    | PullRequestNodePayload
    | CommentNodePayload
    | PullRequestReviewNodePayload
    | PullRequestReviewCommentNodePayload
> extends GithubEntity<T> {
  authors(): Author[] {
    return this.graph
      .neighborhood(this.nodeAddress, {
        edgeType: AUTHORS_EDGE_TYPE,
        nodeType: AUTHOR_NODE_TYPE,
      })
      .map(({neighbor}) => new Author(this.graph, neighbor));
  }

  body(): string {
    return this.node().payload.body;
  }

  references(): Entity[] {
    return this.graph
      .neighborhood(this.nodeAddress, {
        edgeType: REFERENCES_EDGE_TYPE,
        direction: "OUT",
      })
      .map(({neighbor}) => asEntity(this.graph, neighbor));
  }
}

class Commentable<T: IssueNodePayload | PullRequestNodePayload> extends Post<
  T
> {
  comments(): Comment[] {
    return this.graph
      .neighborhood(this.nodeAddress, {
        edgeType: CONTAINS_EDGE_TYPE,
        nodeType: COMMENT_NODE_TYPE,
      })
      .map(({neighbor}) => new Comment(this.graph, neighbor));
  }
}

export class Author extends GithubEntity<AuthorNodePayload> {
  static from(e: Entity): Author {
    assertEntityType(e, AUTHOR_NODE_TYPE);
    return (e: any);
  }
  login(): string {
    return this.node().payload.login;
  }

  subtype(): AuthorSubtype {
    return this.node().payload.subtype;
  }
}

export class PullRequest extends Commentable<PullRequestNodePayload> {
  static from(e: Entity): PullRequest {
    assertEntityType(e, PULL_REQUEST_NODE_TYPE);
    return (e: any);
  }
  number(): number {
    return this.node().payload.number;
  }
  title(): string {
    return this.node().payload.title;
  }
  reviews(): PullRequestReview[] {
    return this.graph
      .neighborhood(this.nodeAddress, {
        edgeType: CONTAINS_EDGE_TYPE,
        nodeType: PULL_REQUEST_REVIEW_NODE_TYPE,
      })
      .map(({neighbor}) => new PullRequestReview(this.graph, neighbor));
  }
  mergeCommitHash(): ?string {
    const mergeEdge = this.graph
      .neighborhood(this.nodeAddress, {
        edgeType: MERGED_AS_EDGE_TYPE,
        nodeType: COMMIT_NODE_TYPE,
        direction: "OUT",
      })
      .map(({edge}) => edge);
    if (mergeEdge.length > 1) {
      throw new Error(
        `Node at ${this.nodeAddress.id} has too many MERGED_AS edges`
      );
    }
    if (mergeEdge.length === 0) {
      return null;
    }
    const payload: MergedAsEdgePayload = (mergeEdge[0].payload: any);
    return payload.hash;
  }
}

export class Issue extends Commentable<IssueNodePayload> {
  static from(e: Entity): Issue {
    assertEntityType(e, ISSUE_NODE_TYPE);
    return (e: any);
  }
  number(): number {
    return this.node().payload.number;
  }
  title(): string {
    return this.node().payload.title;
  }
}

export class Comment extends Post<CommentNodePayload> {
  static from(e: Entity): Comment {
    assertEntityType(e, COMMENT_NODE_TYPE);
    return (e: any);
  }
}

export class PullRequestReview extends Post<PullRequestReviewNodePayload> {
  static from(e: Entity): PullRequestReview {
    assertEntityType(e, PULL_REQUEST_REVIEW_NODE_TYPE);
    return (e: any);
  }
  state(): PullRequestReviewState {
    return this.node().payload.state;
  }

  comments(): PullRequestReviewComment[] {
    return this.graph
      .neighborhood(this.nodeAddress, {
        edgeType: CONTAINS_EDGE_TYPE,
        nodeType: PULL_REQUEST_REVIEW_COMMENT_NODE_TYPE,
      })
      .map(({neighbor}) => new PullRequestReviewComment(this.graph, neighbor));
  }
}

export class PullRequestReviewComment extends Post<
  PullRequestReviewCommentNodePayload
> {
  static from(e: Entity): PullRequestReviewComment {
    assertEntityType(e, PULL_REQUEST_REVIEW_COMMENT_NODE_TYPE);
    return (e: any);
  }
}
