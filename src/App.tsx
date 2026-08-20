import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, apiConfigured, importLocalProgress, loadProgress, saveSession, undoSession, type HistoryEntry, type LocalProgress, type Progress, type Result } from "./api";
import { authConfigured, currentUser, login, logout, type AuthUser } from "./auth";
import { problems } from "./problems";

const STORAGE_KEY = "dsa-daily:v1";
const SESSION_MINUTES = { Easy: 10, Medium: 20, Hard: 30 } as const;
const emptyLocalProgress: LocalProgress = { index: 0, cycle: 1, history: [] };

function formatTime(total: number) {
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function todayKey(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

function sessionSeconds(difficulty: keyof typeof SESSION_MINUTES) {
  return SESSION_MINUTES[difficulty] * 60;
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const completedThisCycle = progress.index;
  const completedToday = useMemo(
    () => progress.history.filter((entry) => todayKey(new Date(entry.finishedAt)) === todayKey()).length,
    [progress.history],
  );

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => {
        setSeconds((value) => {
          if (value <= 1) {
            setRunning(false);
            setLogging(true);
            return 0;
          }
          return value - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running]);

  function startSession() {
    window.open(problem.neetcode, "_blank", "noopener,noreferrer");
    setJustFinished(null);
    setActionError("");
    setStarted(true);
    setRunning(true);
    setSeconds(sessionSeconds(problem.difficulty));
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
      });
      setProgress(saved.progress);
      cacheProgress(saved.progress);
      setJustFinished(saved.entry);
      setStarted(false);
      setRunning(false);
      setLogging(false);
      setResult(null);
      setHeuristic("");
      setSeconds(sessionSeconds(problems[saved.progress.index].difficulty));
    } catch (error) {
      if (error instanceof ApiError && error.code === "progress_conflict") {
        const current = await loadProgress().catch(() => null);
        if (current) {
          setProgress(current);
          cacheProgress(current);
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
          <div className="headerProgress" aria-label={`Cycle ${progress.cycle}, ${completedThisCycle} of 150 complete`}>
            <span>Cycle {progress.cycle}</span>
            <div className="progressTrack"><span style={{ width: `${(completedThisCycle / 150) * 100}%` }} /></div>
            <span>{completedThisCycle}/150</span>
          </div>
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
          <span>{completedToday === 0 ? "Today" : `${completedToday} done today`}</span> · Problem {progress.index + 1} of 150
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
            <button className="primary" onClick={() => setLogging(true)} type="button">Finish &amp; log result</button>
            <button className="textButton" onClick={() => setRunning((value) => !value)} type="button">
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
              {seconds > 0 ? <button className="textButton" disabled={saving} onClick={() => setLogging(false)} type="button">Back to timer</button> : null}
            </div>
          </div>
        ) : null}
      </section>

      <footer>
        <span>One problem. Clean execution. Come back tomorrow.</span>
        {progress.totalSessions > 0 ? <span>{progress.totalSessions} total sessions synced</span> : null}
      </footer>
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
