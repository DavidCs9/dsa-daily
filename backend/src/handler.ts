import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Router } from "@aws-lambda-powertools/event-handler/http";
import {
  advance,
  IMPORTED_HISTORY_LIMIT,
  type HistoryEntry,
  type Progress,
  parseImportInput,
  parseSessionInput,
  parseUndoInput,
  RequestError,
  sessionKey,
} from "./domain.js";

const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error("TABLE_NAME is required.");

const logger = new Logger({ serviceName: "dsa-daily-api" });
const tracer = new Tracer({ serviceName: "dsa-daily-api" });
const lowLevelClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const documentClient = DynamoDBDocumentClient.from(lowLevelClient, {
  marshallOptions: { removeUndefinedValues: true },
});

type ApiEnvironment = { store: { request: { pk: string } } };
const app = new Router<ApiEnvironment>({ logger });

type StateItem = {
  pk: string;
  sk: "STATE";
  index: number;
  cycle: number;
  version: number;
  totalSessions: number;
  updatedAt?: string;
  lastCompletedAt?: string;
  lastSessionKey?: string;
};

type SessionItem = HistoryEntry & {
  pk: string;
  sk: string;
  entity: "session";
};

function userKey(sub: string) {
  return `USER#${sub}`;
}

async function requestBody(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    throw new RequestError("Request body must be valid JSON.");
  }
}

function publicHistory(item: SessionItem): HistoryEntry {
  return {
    problemIndex: item.problemIndex,
    cycle: item.cycle,
    result: item.result,
    heuristic: item.heuristic,
    finishedAt: item.finishedAt,
  };
}

async function readProgress(pk: string): Promise<Progress> {
  const [stateResult, sessionsResult] = await Promise.all([
    documentClient.send(new GetCommand({ TableName: tableName, Key: { pk, sk: "STATE" } })),
    documentClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sessionPrefix)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": pk, ":sessionPrefix": "SESSION#" },
      ScanIndexForward: false,
      Limit: 365,
    })),
  ]);

  const state = stateResult.Item as StateItem | undefined;
  const history = ((sessionsResult.Items ?? []) as SessionItem[]).reverse().map(publicHistory);
  return {
    index: state?.index ?? 0,
    cycle: state?.cycle ?? 1,
    version: state?.version ?? 0,
    totalSessions: state?.totalSessions ?? 0,
    updatedAt: state?.updatedAt,
    history,
    isEmpty: !state,
  };
}

async function saveSession(pk: string, input: ReturnType<typeof parseSessionInput>) {
  const finishedAt = new Date().toISOString();
  const next = advance(input.expectedIndex, input.expectedCycle);
  const key = sessionKey(input.expectedCycle, input.expectedIndex);
  const item: SessionItem = {
    pk,
    sk: key,
    entity: "session",
    problemIndex: input.expectedIndex,
    cycle: input.expectedCycle,
    result: input.result,
    heuristic: input.heuristic,
    finishedAt,
  };

  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": "pk" },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: { pk, sk: "STATE" },
            ConditionExpression: "(attribute_not_exists(#version) AND :expectedVersion = :zero AND :expectedIndex = :zero AND :expectedCycle = :one) OR (#version = :expectedVersion AND #index = :expectedIndex AND #cycle = :expectedCycle)",
            UpdateExpression: "SET #entity = :state, #index = :nextIndex, #cycle = :nextCycle, #version = :nextVersion, #totalSessions = if_not_exists(#totalSessions, :zero) + :one, #updatedAt = :now, #lastCompletedAt = :now, #lastSessionKey = :sessionKey",
            ExpressionAttributeNames: {
              "#entity": "entity",
              "#index": "index",
              "#cycle": "cycle",
              "#version": "version",
              "#totalSessions": "totalSessions",
              "#updatedAt": "updatedAt",
              "#lastCompletedAt": "lastCompletedAt",
              "#lastSessionKey": "lastSessionKey",
            },
            ExpressionAttributeValues: {
              ":state": "state",
              ":expectedIndex": input.expectedIndex,
              ":expectedCycle": input.expectedCycle,
              ":expectedVersion": input.expectedVersion,
              ":nextIndex": next.index,
              ":nextCycle": next.cycle,
              ":nextVersion": input.expectedVersion + 1,
              ":zero": 0,
              ":one": 1,
              ":now": finishedAt,
              ":sessionKey": key,
            },
          },
        },
      ],
    }));
    return { progress: await readProgress(pk), entry: publicHistory(item), idempotent: false };
  } catch (error) {
    if ((error as Error).name !== "TransactionCanceledException") throw error;
    const existing = await documentClient.send(new GetCommand({ TableName: tableName, Key: { pk, sk: key } }));
    if (existing.Item) return { progress: await readProgress(pk), entry: publicHistory(existing.Item as SessionItem), idempotent: true };
    throw new RequestError("Progress changed on another device. Reload and try again.", 409, "progress_conflict");
  }
}

async function undo(pk: string, expectedVersion: number) {
  const [stateResult, sessionsResult] = await Promise.all([
    documentClient.send(new GetCommand({ TableName: tableName, Key: { pk, sk: "STATE" } })),
    documentClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sessionPrefix)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": pk, ":sessionPrefix": "SESSION#" },
      ScanIndexForward: false,
      Limit: 2,
    })),
  ]);
  const state = stateResult.Item as StateItem | undefined;
  const sessions = (sessionsResult.Items ?? []) as SessionItem[];
  const latest = sessions[0];
  const previous = sessions[1];
  if (!state || !latest || !state.lastSessionKey) {
    throw new RequestError("There is no session to undo.", 409, "nothing_to_undo");
  }

  const updateExpression = previous
    ? "SET #index = :index, #cycle = :cycle, #version = :nextVersion, #totalSessions = #totalSessions - :one, #updatedAt = :now, #lastSessionKey = :previousKey, #lastCompletedAt = :previousAt"
    : "SET #index = :index, #cycle = :cycle, #version = :nextVersion, #totalSessions = #totalSessions - :one, #updatedAt = :now REMOVE #lastSessionKey, #lastCompletedAt";
  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: tableName,
            Key: { pk, sk: latest.sk },
            ConditionExpression: "attribute_exists(#pk)",
            ExpressionAttributeNames: { "#pk": "pk" },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: { pk, sk: "STATE" },
            ConditionExpression: "#version = :expectedVersion AND #lastSessionKey = :latestKey",
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: {
              "#index": "index",
              "#cycle": "cycle",
              "#version": "version",
              "#totalSessions": "totalSessions",
              "#updatedAt": "updatedAt",
              "#lastSessionKey": "lastSessionKey",
              "#lastCompletedAt": "lastCompletedAt",
            },
            ExpressionAttributeValues: {
              ":index": latest.problemIndex,
              ":cycle": latest.cycle,
              ":expectedVersion": expectedVersion,
              ":nextVersion": expectedVersion + 1,
              ":one": 1,
              ":now": new Date().toISOString(),
              ":latestKey": latest.sk,
              ":previousKey": previous?.sk,
              ":previousAt": previous?.finishedAt,
            },
          },
        },
      ],
    }));
    return readProgress(pk);
  } catch (error) {
    if ((error as Error).name === "TransactionCanceledException") {
      throw new RequestError("Progress changed on another device. Reload and try again.", 409, "progress_conflict");
    }
    throw error;
  }
}

async function importProgress(pk: string, input: ReturnType<typeof parseImportInput>) {
  const retained = input.history.slice(-IMPORTED_HISTORY_LIMIT);
  const unique = new Map(retained.map((entry) => [sessionKey(entry.cycle, entry.problemIndex), entry]));
  const sessions = [...unique.entries()].map(([sk, entry]) => ({ pk, sk, entity: "session", ...entry } as SessionItem));
  const last = sessions.at(-1);
  const now = new Date().toISOString();
  const state: StateItem & { entity: "state" } = {
    pk,
    sk: "STATE",
    entity: "state",
    index: input.index,
    cycle: input.cycle,
    version: 1,
    totalSessions: input.history.length,
    updatedAt: now,
    lastCompletedAt: last?.finishedAt,
    lastSessionKey: last?.sk,
  };

  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: state,
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": "pk" },
          },
        },
        ...sessions.map((item) => ({
          Put: {
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": "pk" },
          },
        })),
      ],
    }));
    return { progress: await readProgress(pk), importedHistoryCount: sessions.length };
  } catch (error) {
    if ((error as Error).name === "TransactionCanceledException") {
      return { progress: await readProgress(pk), importedHistoryCount: 0 };
    }
    throw error;
  }
}

app.use(async ({ reqCtx, next }) => {
  if (reqCtx.responseType !== "ApiGatewayV2") {
    throw new RequestError("Unsupported event source.", 400, "invalid_event");
  }
  const event = reqCtx.event as APIGatewayProxyEventV2WithJWTAuthorizer;
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (typeof sub !== "string" || claims?.token_use !== "access") {
    throw new RequestError("A valid Cognito access token is required.", 401, "unauthorized");
  }
  reqCtx.set("pk", userKey(sub));
  return next();
});

app.get("/v1/progress", async ({ get }) => ({ progress: await readProgress(get("pk")!) }));

app.post("/v1/sessions", async ({ get, req }) =>
  saveSession(get("pk")!, parseSessionInput(await requestBody(req))));

app.post("/v1/progress/undo", async ({ get, req }) => {
  const input = parseUndoInput(await requestBody(req));
  return { progress: await undo(get("pk")!, input.expectedVersion) };
});

app.post("/v1/progress/import", async ({ get, req }) =>
  importProgress(get("pk")!, parseImportInput(await requestBody(req))));

app.errorHandler(RequestError, async (error) => ({
  statusCode: error.statusCode,
  body: { error: { code: error.code, message: error.message } },
}));

app.errorHandler(Error, async (error) => {
  logger.error("Unhandled API error", { error });
  return {
    statusCode: 500,
    body: { error: { code: "internal_error", message: "Something went wrong." } },
  };
});

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer, context: Context) {
  context.callbackWaitsForEmptyEventLoop = false;
  logger.appendKeys({ requestId: context.awsRequestId, routeKey: event.routeKey });
  tracer.putAnnotation("routeKey", event.routeKey);

  try {
    return await app.resolve(event, context);
  } finally {
    logger.resetKeys();
  }
}
