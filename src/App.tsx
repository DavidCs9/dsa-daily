import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  apiConfigured,
  createHistorySession,
  deleteHistorySession,
  importLocalProgress,
  loadProgress,
  saveSession,
  setNextProblem,
  undoSession,
  updateHistorySession,
  type HistoryEntry,
  type LocalProgress,
  type Progress,
  type Result,
} from "./api";
import { authConfigured, currentUser, login, logout, type AuthUser } from "./auth";
import { calendarDays, summarizeActivity } from "./activity";
import { problems } from "./problems";

const STORAGE_KEY = "dsa-daily:v1";
const SESSION_MINUTES = { Easy: 10, Medium: 20, Hard: 30 } as const;
const emptyLocalProgress: LocalProgress = { index: 0, cycle: 1, history: [] };

function formatTime(total: number) {
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatDuration(total: number | undefined) {
  if (total === undefined) return "Time not recorded";
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function durationMinutes(total: number | undefined) {
  if (total === undefined) return "";
  return Math.round((total / 60) * 10) / 10;
}

function todayKey(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

function sessionSeconds(difficulty: keyof typeof SESSION_MINUTES) {
  return SESSION_MINUTES[difficulty] * 60;
}

function dateTimeInputValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function sessionDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function resultLabel(result: Result) {
  if (result === "solved") return "Solved";
  if (result === "hint") return "Needed hint";
  return "Not solved";
}

function readLocalProgress(): LocalProgress {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return emptyLocalProgress;
    const parsed = JSON.parse(stored) as LocalProgress;
    if (Number.isInteger(parsed.index) && parsed.index >= 0 && parsed.index < problems.length) {
      return {
        index: parsed.index,
        cycle: Number.isInteger(parsed.cycle) && parsed.cycle > 0 ? parsed.cycle : 1,
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    }
  } catch {
    // Ignore corrupt legacy state; the server remains the source of truth.
  }
  return emptyLocalProgress;
}

function cacheProgress(progress: Progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    index: progress.index,
    cycle: progress.cycle,
    history: progress.history,
  } satisfies LocalProgress));
}

function messageFrom(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "Your session expired. Sign in again.";
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}

function LoginScreen({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSignedIn(await login(email, password));
    } catch (signInError) {
      const name = signInError instanceof Error ? signInError.name : "";
      setError(name === "NotAuthorizedException" || name === "UserNotFoundException"
        ? "Email or password didn’t match."
        : messageFrom(signInError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authShell">
      <section className="authCard" aria-labelledby="sign-in-title">
        <a className="brand authBrand" href="#top" aria-label="DSA Daily home">
          <span className="brandMark">D</span>
          <span>DSA Daily</span>
        </a>
        <p className="eyebrow"><span>Welcome back</span></p>
        <h1 id="sign-in-title">Keep the loop warm.</h1>
        <p className="authIntro">Sign in with your existing account. Your next problem stays in sync on every device.</p>
        <form className="authForm" onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" autoComplete="username" inputMode="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error ? <p className="errorNote" role="alert">{error}</p> : null}
          <button className="primary" disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}

function DailySession({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      setLoadError("");
      try {
        let remote = await loadProgress();
        const local = readLocalProgress();
        const hasLocalProgress = local.index !== 0 || local.cycle !== 1 || local.history.length > 0;
        if (remote.isEmpty && hasLocalProgress) remote = await importLocalProgress(local);
        if (!active) return;
        cacheProgress(remote);
        setProgress(remote);
      } catch (error) {
        if (active) setLoadError(messageFrom(error));
      }
    }
    void hydrate();
    return () => { active = false; };
  }, [retry]);

  if (loadError) {
    return (
      <main className="authShell">
        <section className="authCard compactCard">
          <p className="eyebrow"><span>Couldn’t load progress</span></p>
          <p className="authIntro errorText" role="alert">{loadError}</p>
          <button className="primary" onClick={() => setRetry((value) => value + 1)} type="button">Try again</button>
          <button className="textButton" onClick={onSignedOut} type="button">Sign out</button>
        </section>
      </main>
    );
  }
  if (!progress) return <main className="loading" aria-label="Loading progress" />;
  return <SessionView progress={progress} setProgress={setProgress} user={user} onSignedOut={onSignedOut} />;
}

function ActivityCalendar({ history }: { history: HistoryEntry[] }) {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [month, setMonth] = useState(currentMonth);
  const activity = useMemo(() => summarizeActivity(history), [history]);
  const days = useMemo(() => calendarDays(month, activity.byDay), [activity.byDay, month]);
  const sessionsThisMonth = days
    .filter((day) => day.inMonth)
    .reduce((total, day) => total + day.sessions, 0);
  const isCurrentMonth = month.getFullYear() === currentMonth.getFullYear() && month.getMonth() === currentMonth.getMonth();

  function moveMonth(offset: number) {
    setMonth((value) => new Date(value.getFullYear(), value.getMonth() + offset, 1));
  }

  return (
    <section className="activityPanel" aria-labelledby="activity-title">
      <div className="streakStats">
        <div className="primaryStreak">
          <span>Current streak</span>
          <strong>{activity.currentStreak}</strong>
          <small>{activity.currentStreak === 1 ? "day" : "days"}</small>
        </div>
        <div><span>Best streak</span><strong>{activity.bestStreak}</strong><small>days</small></div>
        <div><span>Active days</span><strong>{activity.activeDays}</strong><small>total</small></div>
        <div><span>This month</span><strong>{sessionsThisMonth}</strong><small>sessions</small></div>
      </div>

      <div className="calendarHeader">
        <div>
          <p className="calendarKicker">Activity calendar</p>
          <h3 id="activity-title">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>
        </div>
        <div className="calendarNav" aria-label="Change calendar month">
          <button onClick={() => moveMonth(-1)} type="button" aria-label="Previous month">Previous</button>
          <button disabled={isCurrentMonth} onClick={() => moveMonth(1)} type="button" aria-label="Next month">Next</button>
        </div>
      </div>

      <div className="calendarWeekdays" aria-hidden="true">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendarGrid" role="grid" aria-label={`DSA activity for ${month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`}>
        {days.map((day) => {
          const label = `${day.date.toLocaleDateString(undefined, { dateStyle: "long" })}: ${day.sessions} ${day.sessions === 1 ? "session" : "sessions"}`;
          const intensity = day.sessions >= 3 ? "intensityThree" : day.sessions === 2 ? "intensityTwo" : day.sessions === 1 ? "intensityOne" : "";
          return (
            <div
              className={`calendarDay ${day.inMonth ? "" : "outsideMonth"} ${day.isToday ? "today" : ""} ${intensity}`}
              key={day.key}
              role="gridcell"
              aria-label={label}
              title={label}
            >
              <time dateTime={day.key}>{day.dayNumber}</time>
              {day.sessions > 0 ? <span className="sessionMark">{day.sessions > 1 ? day.sessions : ""}</span> : null}
            </div>
          );
        })}
      </div>
      <p className="calendarNote">A day counts toward the streak when at least one session is logged. Today or yesterday can anchor the current streak.</p>
    </section>
  );
}

function HistoryManager({
  progress,
  onProgress,
  onClose,
}: {
  progress: Progress;
  onProgress: (progress: Progress) => void;
  onClose: () => void;
}) {
  const [nextProblem, setNextProblemNumber] = useState(progress.index + 1);
  const [nextCycle, setNextCycle] = useState(progress.cycle);
  const [newProblem, setNewProblem] = useState(progress.index + 1);
  const [newCycle, setNewCycle] = useState(progress.cycle);
  const [newResult, setNewResult] = useState<Result>("solved");
  const [newHeuristic, setNewHeuristic] = useState("");
  const [newFinishedAt, setNewFinishedAt] = useState(dateTimeInputValue(new Date()));
  const [newDurationMinutes, setNewDurationMinutes] = useState<number | "">("");
  const [editing, setEditing] = useState<HistoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = useMemo(
    () => [...progress.history].sort((left, right) => right.finishedAt.localeCompare(left.finishedAt)),
    [progress.history],
  );

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  function acceptProgress(value: Progress) {
    cacheProgress(value);
    onProgress(value);
  }

  async function runMutation(action: () => Promise<Progress>) {
    setBusy(true);
    setError("");
    try {
      acceptProgress(await action());
      return true;
    } catch (mutationError) {
      if (mutationError instanceof ApiError && mutationError.code === "progress_conflict") {
        const current = await loadProgress().catch(() => null);
        if (current) acceptProgress(current);
      }
      setError(messageFrom(mutationError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function repairIndex(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Set the next problem to ${nextProblem} in cycle ${nextCycle}? Session history will stay unchanged.`)) return;
    await runMutation(() => setNextProblem({
      index: nextProblem - 1,
      cycle: nextCycle,
      expectedVersion: progress.version,
    }));
  }

  async function addSession(event: FormEvent) {
    event.preventDefault();
    const saved = await runMutation(() => createHistorySession({
      problemIndex: newProblem - 1,
      cycle: newCycle,
      expectedVersion: progress.version,
      result: newResult,
      heuristic: newHeuristic.trim(),
      finishedAt: new Date(newFinishedAt).toISOString(),
      durationSeconds: newDurationMinutes === "" ? undefined : Math.round(newDurationMinutes * 60),
    }));
    if (saved) {
      setNewHeuristic("");
      setNewFinishedAt(dateTimeInputValue(new Date()));
      setNewDurationMinutes("");
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const saved = await runMutation(() => updateHistorySession(editing, {
      expectedVersion: progress.version,
      result: editing.result,
      heuristic: editing.heuristic.trim(),
      finishedAt: new Date(editing.finishedAt).toISOString(),
      durationSeconds: editing.durationSeconds,
    }));
    if (saved) setEditing(null);
  }

  async function removeSession(entry: HistoryEntry) {
    const title = problems[entry.problemIndex]?.title ?? `Problem ${entry.problemIndex + 1}`;
    if (!window.confirm(`Delete the cycle ${entry.cycle} record for ${title}? The next-problem index will not move.`)) return;
    await runMutation(() => deleteHistorySession(entry, progress.version));
  }

  return (
    <div className="managerOverlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="managerDialog" role="dialog" aria-modal="true" aria-labelledby="manager-title">
        <header className="managerHeader">
          <div>
            <p className="eyebrow"><span>History, streak &amp; repair</span></p>
            <h2 id="manager-title">Manage progress</h2>
          </div>
          <button className="closeButton" disabled={busy} onClick={onClose} type="button" aria-label="Close history">Close</button>
        </header>

        {error ? <p className="errorNote managerError" role="alert">{error}</p> : null}

        <ActivityCalendar history={progress.history} />

        <section className="repairPanel" aria-labelledby="repair-title">
          <div>
            <h3 id="repair-title">Set next problem</h3>
            <p>Moves the pointer only. Existing sessions are not changed.</p>
          </div>
          <form className="compactForm" onSubmit={(event) => void repairIndex(event)}>
            <label htmlFor="next-problem">Problem</label>
            <input id="next-problem" min="1" max={problems.length} required type="number" value={nextProblem} onChange={(event) => setNextProblemNumber(Number(event.target.value))} />
            <label htmlFor="next-cycle">Cycle</label>
            <input id="next-cycle" min="1" required type="number" value={nextCycle} onChange={(event) => setNextCycle(Number(event.target.value))} />
            <button className="secondaryButton" disabled={busy} type="submit">Set next</button>
          </form>
        </section>

        <details className="addSessionPanel">
          <summary>Add a missing session</summary>
          <p className="managerHelp">Adds one history record without moving the next-problem pointer.</p>
          <form className="managerForm" onSubmit={(event) => void addSession(event)}>
            <div className="formRow">
              <label htmlFor="new-problem">Problem
                <input id="new-problem" min="1" max={problems.length} required type="number" value={newProblem} onChange={(event) => setNewProblem(Number(event.target.value))} />
              </label>
              <label htmlFor="new-cycle">Cycle
                <input id="new-cycle" min="1" required type="number" value={newCycle} onChange={(event) => setNewCycle(Number(event.target.value))} />
              </label>
              <label htmlFor="new-result">Result
                <select id="new-result" value={newResult} onChange={(event) => setNewResult(event.target.value as Result)}>
                  <option value="solved">Solved</option>
                  <option value="hint">Needed hint</option>
                  <option value="not-solved">Not solved</option>
                </select>
              </label>
            </div>
            <label htmlFor="new-date">Finished at
              <input id="new-date" required type="datetime-local" value={newFinishedAt} onChange={(event) => setNewFinishedAt(event.target.value)} />
            </label>
            <label htmlFor="new-duration">Focused minutes (optional)
              <input id="new-duration" min="0" max="240" step="0.1" type="number" value={newDurationMinutes} onChange={(event) => setNewDurationMinutes(event.target.value === "" ? "" : Number(event.target.value))} placeholder="e.g. 10" />
            </label>
            <label htmlFor="new-heuristic">Heuristic
              <input id="new-heuristic" maxLength={160} value={newHeuristic} onChange={(event) => setNewHeuristic(event.target.value)} placeholder="Optional one-line note" />
            </label>
            <button className="secondaryButton" disabled={busy} type="submit">Add session</button>
          </form>
        </details>

        <section className="historySection" aria-labelledby="history-title">
          <div className="historyHeading">
            <h3 id="history-title">Past sessions</h3>
            <span>{progress.totalSessions} total</span>
          </div>
          {history.length === 0 ? <p className="emptyHistory">No sessions recorded yet.</p> : (
            <div className="historyList">
              {history.map((entry) => {
                const key = `${entry.cycle}:${entry.problemIndex}`;
                const isEditing = editing?.cycle === entry.cycle && editing.problemIndex === entry.problemIndex;
                const title = problems[entry.problemIndex]?.title ?? `Problem ${entry.problemIndex + 1}`;
                return (
                  <article className="historyItem" key={key}>
                    {isEditing && editing ? (
                      <form className="managerForm editForm" onSubmit={(event) => void saveEdit(event)}>
                        <strong>Cycle {entry.cycle} · #{entry.problemIndex + 1} {title}</strong>
                        <div className="formRow editRow">
                          <label htmlFor={`edit-result-${key}`}>Result
                            <select id={`edit-result-${key}`} value={editing.result} onChange={(event) => setEditing({ ...editing, result: event.target.value as Result })}>
                              <option value="solved">Solved</option>
                              <option value="hint">Needed hint</option>
                              <option value="not-solved">Not solved</option>
                            </select>
                          </label>
                          <label htmlFor={`edit-date-${key}`}>Finished at
                            <input id={`edit-date-${key}`} required type="datetime-local" value={dateTimeInputValue(editing.finishedAt)} onChange={(event) => setEditing({ ...editing, finishedAt: new Date(event.target.value).toISOString() })} />
                          </label>
                          <label htmlFor={`edit-duration-${key}`}>Focused minutes
                            <input id={`edit-duration-${key}`} min="0" max="240" step="0.1" type="number" value={durationMinutes(editing.durationSeconds)} onChange={(event) => setEditing({ ...editing, durationSeconds: event.target.value === "" ? undefined : Math.round(Number(event.target.value) * 60) })} placeholder="Not recorded" />
                          </label>
                        </div>
                        <label htmlFor={`edit-heuristic-${key}`}>Heuristic
                          <input id={`edit-heuristic-${key}`} maxLength={160} value={editing.heuristic} onChange={(event) => setEditing({ ...editing, heuristic: event.target.value })} />
                        </label>
                        <div className="itemActions">
                          <button className="secondaryButton" disabled={busy} type="submit">Save</button>
                          <button className="textButton" disabled={busy} onClick={() => setEditing(null)} type="button">Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="historyBody">
                          <strong>#{entry.problemIndex + 1} {title}</strong>
                          <div className="sessionMeta">
                            <span>Cycle {entry.cycle} · {resultLabel(entry.result)} · {sessionDate(entry.finishedAt)}</span>
                            <strong className={entry.durationSeconds === undefined ? "timeSpent missingTime" : "timeSpent"}>Focused {formatDuration(entry.durationSeconds)}</strong>
                          </div>
                          {entry.heuristic ? <p>{entry.heuristic}</p> : null}
                        </div>
                        <div className="itemActions">
                          <button className="textButton" disabled={busy} onClick={() => setEditing(entry)} type="button">Edit</button>
                          <button className="dangerButton" disabled={busy} onClick={() => void removeSession(entry)} type="button">Delete</button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function SessionView({
  progress,
  setProgress,
  user,
  onSignedOut,
}: {
  progress: Progress;
  setProgress: (progress: Progress) => void;
  user: AuthUser;
  onSignedOut: () => void;
}) {
  const problem = problems[progress.index] ?? problems[0];
  const [seconds, setSeconds] = useState(sessionSeconds(problem.difficulty));
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [logging, setLogging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [heuristic, setHeuristic] = useState("");
  const [actionError, setActionError] = useState("");
  const [justFinished, setJustFinished] = useState<HistoryEntry | null>(null);
  const [managing, setManaging] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number | null>(null);

  const completedThisCycle = progress.index;
  const completedToday = useMemo(
    () => progress.history.filter((entry) => todayKey(new Date(entry.finishedAt)) === todayKey()).length,
    [progress.history],
  );
  const activity = useMemo(() => summarizeActivity(progress.history), [progress.history]);

  useEffect(() => {
    if (!running) return;
    function tick() {
      if (deadlineRef.current === null) return;
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) {
        deadlineRef.current = null;
        setRunning(false);
        setLogging(true);
      }
    }
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running]);

  function currentRemainingSeconds() {
    if (deadlineRef.current === null) return seconds;
    return Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
  }

  function startSession() {
    window.open(problem.neetcode, "_blank", "noopener,noreferrer");
    setJustFinished(null);
    setActionError("");
    setStarted(true);
    setRunning(true);
    const allottedSeconds = sessionSeconds(problem.difficulty);
    setSeconds(allottedSeconds);
    deadlineRef.current = Date.now() + allottedSeconds * 1000;
  }

  function finishSession() {
    const remaining = currentRemainingSeconds();
    deadlineRef.current = null;
    setSeconds(remaining);
    setRunning(false);
    setLogging(true);
  }

  function toggleTimer() {
    if (running) {
      const remaining = currentRemainingSeconds();
      deadlineRef.current = null;
      setSeconds(remaining);
      setRunning(false);
      return;
    }
    if (seconds > 0) {
      deadlineRef.current = Date.now() + seconds * 1000;
      setRunning(true);
    }
  }

  function returnToTimer() {
    if (seconds <= 0) return;
    setLogging(false);
    deadlineRef.current = Date.now() + seconds * 1000;
    setRunning(true);
  }

  async function logResult() {
    if (!result || saving) return;
    setSaving(true);
    setActionError("");
    try {
      const saved = await saveSession({
        expectedIndex: progress.index,
        expectedCycle: progress.cycle,
        expectedVersion: progress.version,
        result,
        heuristic: heuristic.trim(),
        durationSeconds: sessionSeconds(problem.difficulty) - seconds,
      });
      setProgress(saved.progress);
      cacheProgress(saved.progress);
      setJustFinished(saved.entry);
      setStarted(false);
      setRunning(false);
      setLogging(false);
      setResult(null);
      setHeuristic("");
      deadlineRef.current = null;
      setSeconds(sessionSeconds(problems[saved.progress.index].difficulty));
    } catch (error) {
      if (error instanceof ApiError && error.code === "progress_conflict") {
        const current = await loadProgress().catch(() => null);
        if (current) {
          setProgress(current);
          cacheProgress(current);
          deadlineRef.current = null;
          setSeconds(sessionSeconds(problems[current.index].difficulty));
        }
      }
      setActionError(messageFrom(error));
    } finally {
      setSaving(false);
    }
  }

  async function undoLast() {
    if (!justFinished || saving) return;
    setSaving(true);
    setActionError("");
    try {
      const restored = await undoSession(progress.version);
      setProgress(restored);
      cacheProgress(restored);
      setSeconds(sessionSeconds(problems[restored.index].difficulty));
      setJustFinished(null);
    } catch (error) {
      setActionError(messageFrom(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DSA Daily home">
          <span className="brandMark">D</span>
          <span>DSA Daily</span>
        </a>
        <div className="headerRight">
          <div className="headerProgress" aria-label={`Cycle ${progress.cycle}, ${completedThisCycle} problems completed, next problem ${progress.index + 1}`}>
            <span>Cycle {progress.cycle}</span>
            <div className="progressTrack"><span style={{ width: `${(completedThisCycle / 150) * 100}%` }} /></div>
            <span>{completedThisCycle} completed</span>
          </div>
          <button className="streakButton" onClick={() => setManaging(true)} type="button" aria-label={`Current streak: ${activity.currentStreak} days. Open activity calendar.`}>
            <span className="streakDot" />
            <span><strong>{activity.currentStreak}</strong> day{activity.currentStreak === 1 ? "" : "s"} streak</span>
          </button>
          <button className="accountButton" onClick={() => setManaging(true)} type="button">History</button>
          <button className="accountButton" onClick={onSignedOut} title={`Signed in as ${user.signInDetails?.loginId ?? user.username}`} type="button">Sign out</button>
        </div>
      </header>

      <section className="sessionCard" id="top" aria-live="polite">
        {justFinished && !started ? (
          <div className="successNote">
            <span className="successIcon">✓</span>
            <div>
              <strong>Logged. Problem {progress.index + 1} is ready.</strong>
              <button disabled={saving} onClick={() => void undoLast()} type="button">Undo</button>
            </div>
          </div>
        ) : null}

        {actionError ? <p className="errorNote actionError" role="alert">{actionError}</p> : null}
        <p className="eyebrow">
          <span>{completedToday === 0 ? "Next" : `${completedToday} done today · Next`}</span> · Problem {progress.index + 1} of 150
        </p>
        <h1>{problem.title}</h1>
        <div className="meta">
          <span>{problem.category}</span><i />
          <span className={problem.difficulty.toLowerCase()}>{problem.difficulty}</span>
        </div>

        <div className={`timer ${seconds === 0 ? "expired" : ""}`} aria-label={`${formatTime(seconds)} remaining`}>
          <span>{formatTime(seconds)}</span>
          <small>{seconds === 0 ? "Time. Capture the result honestly." : `${SESSION_MINUTES[problem.difficulty]} focused minutes. That’s it.`}</small>
        </div>

        {!started && !logging ? (
          <div className="actions">
            <button className="primary" onClick={startSession} type="button">
              {completedToday > 0 ? "Do one more" : "Start session"}
            </button>
            <p className="quiet">Starts the timer and opens NeetCode.</p>
            <div className="problemLinks">
              <a href={problem.neetcode} target="_blank" rel="noreferrer">NeetCode ↗</a>
              {problem.leetcode ? <a href={problem.leetcode} target="_blank" rel="noreferrer">LeetCode ↗</a> : null}
            </div>
          </div>
        ) : null}

        {started && !logging ? (
          <div className="activeActions">
            <button className="primary" onClick={finishSession} type="button">Finish &amp; log result</button>
            <button className="textButton" onClick={toggleTimer} type="button">
              {running ? "Pause timer" : "Resume timer"}
            </button>
            <div className="problemLinks">
              <a href={problem.neetcode} target="_blank" rel="noreferrer">Reopen problem ↗</a>
            </div>
          </div>
        ) : null}

        {logging ? (
          <div className="logPanel">
            <h2>How did it go?</h2>
            <div className="resultGrid" role="radiogroup" aria-label="Session result">
              <button className={result === "solved" ? "selected" : ""} onClick={() => setResult("solved")} role="radio" aria-checked={result === "solved"} type="button"><span>✓</span>Solved</button>
              <button className={result === "hint" ? "selected" : ""} onClick={() => setResult("hint")} role="radio" aria-checked={result === "hint"} type="button"><span>↗</span>Needed hint</button>
              <button className={result === "not-solved" ? "selected" : ""} onClick={() => setResult("not-solved")} role="radio" aria-checked={result === "not-solved"} type="button"><span>—</span>Not solved</button>
            </div>
            <label htmlFor="heuristic">One-line heuristic <span>optional</span></label>
            <input id="heuristic" maxLength={160} value={heuristic} onChange={(event) => setHeuristic(event.target.value)} placeholder="e.g. Track what I’ve already seen with a set" />
            <div className="logActions">
              <button className="primary" disabled={!result || saving} onClick={() => void logResult()} type="button">{saving ? "Saving…" : "Save & advance"}</button>
              {seconds > 0 ? <button className="textButton" disabled={saving} onClick={returnToTimer} type="button">Back to timer</button> : null}
            </div>
          </div>
        ) : null}
      </section>

      <footer>
        <span>One problem. Clean execution. Come back tomorrow.</span>
        {progress.totalSessions > 0 ? <span>{progress.totalSessions} total sessions synced</span> : null}
      </footer>
      {managing ? <HistoryManager progress={progress} onProgress={setProgress} onClose={() => setManaging(false)} /> : null}
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let active = true;
    currentUser().then((existing) => {
      if (active) {
        setUser(existing);
        setCheckingAuth(false);
      }
    });
    return () => { active = false; };
  }, []);

  async function signOutCurrentUser() {
    await logout().catch(() => undefined);
    setUser(null);
  }

  if (!authConfigured || !apiConfigured) {
    return (
      <main className="authShell">
        <section className="authCard compactCard">
          <p className="eyebrow"><span>Configuration required</span></p>
          <p className="authIntro">The Cognito user pool client and API URL must be supplied at build time.</p>
        </section>
      </main>
    );
  }
  if (checkingAuth) return <main className="loading" aria-label="Checking sign-in" />;
  if (!user) return <LoginScreen onSignedIn={setUser} />;
  return <DailySession key={user.userId} user={user} onSignedOut={() => void signOutCurrentUser()} />;
}
