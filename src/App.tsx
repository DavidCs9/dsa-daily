import { useEffect, useMemo, useRef, useState } from "react";
import { problems } from "./problems";

const STORAGE_KEY = "dsa-daily:v1";
const SESSION_MINUTES = { Easy: 10, Medium: 20, Hard: 30 } as const;

type Result = "solved" | "hint" | "not-solved";
type HistoryEntry = {
  problemIndex: number;
  cycle: number;
  result: Result;
  heuristic: string;
  finishedAt: string;
};
type Progress = { index: number; cycle: number; history: HistoryEntry[] };

const emptyProgress: Progress = { index: 0, cycle: 1, history: [] };

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

function readProgress(): Progress {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return emptyProgress;
    const parsed = JSON.parse(stored) as Progress;
    if (Number.isInteger(parsed.index) && parsed.index >= 0 && parsed.index < problems.length) {
      return { ...parsed, history: Array.isArray(parsed.history) ? parsed.history : [] };
    }
  } catch {
    // A fresh start is safer than blocking the daily session on corrupt local state.
  }
  return emptyProgress;
}

export default function App() {
  const [progress, setProgress] = useState<Progress>(readProgress);
  const problem = problems[progress.index] ?? problems[0];
  const [seconds, setSeconds] = useState(sessionSeconds(problem.difficulty));
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [logging, setLogging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [heuristic, setHeuristic] = useState("");
  const [justFinished, setJustFinished] = useState<HistoryEntry | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const completedThisCycle = progress.index;
  const completedToday = useMemo(
    () => progress.history.filter((entry) => todayKey(new Date(entry.finishedAt)) === todayKey()).length,
    [progress.history],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

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
    setStarted(true);
    setRunning(true);
    setSeconds(sessionSeconds(problem.difficulty));
  }

  function logResult() {
    if (!result) return;
    const entry: HistoryEntry = {
      problemIndex: progress.index,
      cycle: progress.cycle,
      result,
      heuristic: heuristic.trim(),
      finishedAt: new Date().toISOString(),
    };
    const isLast = progress.index === problems.length - 1;
    setProgress((current) => ({
      index: isLast ? 0 : current.index + 1,
      cycle: isLast ? current.cycle + 1 : current.cycle,
      history: [...current.history, entry],
    }));
    setJustFinished(entry);
    setStarted(false);
    setRunning(false);
    setLogging(false);
    setResult(null);
    setHeuristic("");
    const nextIndex = isLast ? 0 : progress.index + 1;
    setSeconds(sessionSeconds(problems[nextIndex].difficulty));
  }

  function undoLast() {
    if (!justFinished) return;
    setProgress((current) => ({
      index: justFinished.problemIndex,
      cycle: justFinished.cycle,
      history: current.history.slice(0, -1),
    }));
    setSeconds(sessionSeconds(problems[justFinished.problemIndex].difficulty));
    setJustFinished(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DSA Daily home">
          <span className="brandMark">D</span>
          <span>DSA Daily</span>
        </a>
        <div className="headerProgress" aria-label={`Cycle ${progress.cycle}, ${completedThisCycle} of 150 complete`}>
          <span>Cycle {progress.cycle}</span>
          <div className="progressTrack"><span style={{ width: `${(completedThisCycle / 150) * 100}%` }} /></div>
          <span>{completedThisCycle}/150</span>
        </div>
      </header>

      <section className="sessionCard" id="top" aria-live="polite">
        {justFinished && !started ? (
          <div className="successNote">
            <span className="successIcon">✓</span>
            <div>
              <strong>Logged. Problem {progress.index + 1} is ready.</strong>
              <button onClick={undoLast} type="button">Undo</button>
            </div>
          </div>
        ) : null}

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
              <button className="primary" disabled={!result} onClick={logResult} type="button">Save &amp; advance</button>
              {seconds > 0 ? <button className="textButton" onClick={() => setLogging(false)} type="button">Back to timer</button> : null}
            </div>
          </div>
        ) : null}
      </section>

      <footer>
        <span>One problem. Clean execution. Come back tomorrow.</span>
        {progress.history.length > 0 ? <span>{progress.history.length} total sessions logged on this device</span> : null}
      </footer>
    </main>
  );
}
