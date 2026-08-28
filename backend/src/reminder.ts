import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, paginateQuery } from "@aws-sdk/lib-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { evaluateReminder, type ReminderHistoryEntry, type ReminderKind } from "./reminder-domain.js";

const tableName = process.env.TABLE_NAME;
const topicArn = process.env.TOPIC_ARN;
const reminderUserId = process.env.REMINDER_USER_ID;
const appUrl = process.env.APP_URL ?? "https://dsa.castrodavid.dev";
const timeZone = process.env.REMINDER_TIME_ZONE ?? "America/Mexico_City";
if (!tableName) throw new Error("TABLE_NAME is required.");
if (!topicArn) throw new Error("TOPIC_ARN is required.");
if (!reminderUserId) throw new Error("REMINDER_USER_ID is required.");

const logger = new Logger({ serviceName: "dsa-daily-reminder" });
const tracer = new Tracer({ serviceName: "dsa-daily-reminder" });
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = tracer.captureAWSv3Client(new SNSClient({}));
const pk = `USER#${reminderUserId}`;

type ReminderEvent = { kind?: unknown; now?: unknown };
type StateItem = { index?: number; totalSessions?: number };

function reminderKind(value: unknown): ReminderKind {
  if (value === "practice" || value === "streak") return value;
  throw new Error("Reminder event kind must be practice or streak.");
}

function invocationTime(value: unknown) {
  if (typeof value !== "string") return new Date();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Reminder event now must be an ISO timestamp.");
  return date;
}

async function readReminderState() {
  const stateResult = await documentClient.send(new GetCommand({
    TableName: tableName,
    Key: { pk, sk: "STATE" },
    ProjectionExpression: "#index, #totalSessions",
    ExpressionAttributeNames: { "#index": "index", "#totalSessions": "totalSessions" },
  }));
  if (!stateResult.Item) return null;

  const history: ReminderHistoryEntry[] = [];
  const pages = paginateQuery({ client: documentClient }, {
    TableName: tableName,
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sessionPrefix)",
    ProjectionExpression: "#finishedAt",
    ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk", "#finishedAt": "finishedAt" },
    ExpressionAttributeValues: { ":pk": pk, ":sessionPrefix": "SESSION#" },
  });
  for await (const page of pages) {
    for (const item of page.Items ?? []) {
      if (typeof item.finishedAt === "string") history.push({ finishedAt: item.finishedAt });
    }
  }
  return { history, state: stateResult.Item as StateItem };
}

function message(kind: ReminderKind, currentStreak: number, nextProblem: number) {
  if (kind === "streak") {
    return {
      subject: `DSA Ready: your ${currentStreak}-day streak is at risk`,
      body: [
        "Your streak will end at midnight if you do not log a session today.",
        `Problem ${nextProblem} is waiting: ${appUrl}`,
        "",
        "This is your 8:00 PM fallback reminder.",
      ].join("\n"),
    };
  }
  return {
    subject: "DSA Ready: today's challenge is waiting",
    body: [
      "You have not logged today's DSA challenge yet.",
      `Start problem ${nextProblem}: ${appUrl}`,
      "",
      "This is your 3:00 PM practice reminder.",
    ].join("\n"),
  };
}

export async function handler(event: ReminderEvent) {
  const kind = reminderKind(event.kind);
  const now = invocationTime(event.now);
  const reminderState = await readReminderState();
  if (!reminderState) {
    logger.info("Skipping reminder because no progress state exists.", { kind });
    return { sent: false, reason: "no_progress" };
  }

  const decision = evaluateReminder(kind, reminderState.history, now, timeZone);
  if (!decision.shouldSend) {
    const reason = decision.completedToday ? "completed_today" : "no_active_streak";
    logger.info("Skipping reminder.", { kind, reason, today: decision.today });
    return { sent: false, reason };
  }

  const nextProblem = (reminderState.state.index ?? 0) + 1;
  const notification = message(kind, decision.currentStreak, nextProblem);
  await snsClient.send(new PublishCommand({
    TopicArn: topicArn,
    Subject: notification.subject,
    Message: notification.body,
  }));
  logger.info("Published reminder.", {
    currentStreak: decision.currentStreak,
    kind,
    nextProblem,
    today: decision.today,
  });
  return { sent: true, kind };
}
