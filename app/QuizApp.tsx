"use client";

/* eslint-disable @next/next/no-img-element -- these are tiny self-hosted SVG study assets, not photographic content */

import { useEffect, useMemo, useState } from "react";
import { countries, Country } from "./countries";

type Topic = "flags" | "capitals";
type Direction = "country-to-answer" | "answer-to-country";
type View = "learn" | "countries";
type SyncStatus = "syncing" | "synced" | "local" | "error";

type CountryProgress = {
  attempts: number;
  correct: number;
  streak: number;
  mastered: boolean;
};

type Progress = Record<Topic, Record<string, CountryProgress>>;

type Question = {
  country: Country;
  direction: Direction;
  options: Country[];
};

type QuizState = {
  questions: Question[];
  index: number;
  score: number;
  selectedCode: string | null;
  complete: boolean;
};

const STORAGE_KEY = "wayfinder-geography-progress-v1";
const emptyProgress: Progress = { flags: {}, capitals: {} };

function mergeProgress(local: Progress, remote: Progress): Progress {
  const merged: Progress = { flags: {}, capitals: {} };
  for (const topic of ["flags", "capitals"] as Topic[]) {
    const codes = new Set([...Object.keys(local[topic] ?? {}), ...Object.keys(remote[topic] ?? {})]);
    for (const code of codes) {
      const localRecord = local[topic]?.[code];
      const remoteRecord = remote[topic]?.[code];
      if (!localRecord && remoteRecord) merged[topic][code] = remoteRecord;
      else if (!remoteRecord && localRecord) merged[topic][code] = localRecord;
      else {
        if (!localRecord || !remoteRecord) continue;
        merged[topic][code] = {
          attempts: Math.max(localRecord.attempts, remoteRecord.attempts),
          correct: Math.max(localRecord.correct, remoteRecord.correct),
          streak: Math.max(localRecord.streak, remoteRecord.streak),
          mastered: localRecord.mastered || remoteRecord.mastered,
        };
      }
    }
  }
  return merged;
}

function isProgress(value: unknown): value is Progress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Progress>;
  return Boolean(candidate.flags && typeof candidate.flags === "object" && candidate.capitals && typeof candidate.capitals === "object");
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeQuestion(country: Country, direction: Direction): Question {
  const distractors = shuffle(countries.filter((item) => item.code !== country.code)).slice(0, 3);
  return { country, direction, options: shuffle([country, ...distractors]) };
}

function buildQuiz(topic: Topic, length: number, progress: Progress): Question[] {
  const available = countries.filter((country) => !progress[topic][country.code]?.mastered);
  const pool = shuffle(available).slice(0, Math.min(length, available.length));
  const firstDirection: Direction = Math.random() > 0.5 ? "country-to-answer" : "answer-to-country";

  return pool.map((country, index) =>
    makeQuestion(
      country,
      index % 2 === 0
        ? firstDirection
        : firstDirection === "country-to-answer"
          ? "answer-to-country"
          : "country-to-answer",
    ),
  );
}

function plural(value: number, word: string) {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

function FlagImage({ code, label, className = "" }: { code: string; label?: string; className?: string }) {
  return (
    <img
      className={`flag-image ${className}`}
      src={`/flags/${code.toLocaleLowerCase()}.svg`}
      alt={label ?? ""}
      draggable={false}
    />
  );
}

export default function QuizApp() {
  const [topic, setTopic] = useState<Topic>("flags");
  const [view, setView] = useState<View>("learn");
  const [quizLength, setQuizLength] = useState(20);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [hydrated, setHydrated] = useState(false);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [search, setSearch] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      let localProgress = emptyProgress;
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const parsed = stored ? (JSON.parse(stored) as unknown) : null;
        if (isProgress(parsed)) localProgress = parsed;
      } catch {
        // Keep a clean slate if browser storage is unavailable or malformed.
      }
      setProgress(localProgress);
      setHydrated(true);
      void (async () => {
        try {
          const response = await fetch("/api/progress", { headers: { Accept: "application/json" } });
          if (response.status === 401) {
            setSyncStatus("local");
            return;
          }
          if (!response.ok) throw new Error("Progress could not be loaded");
          const payload = (await response.json()) as { progress?: unknown };
          const remoteProgress = isProgress(payload.progress) ? payload.progress : emptyProgress;
          const merged = mergeProgress(localProgress, remoteProgress);
          setProgress(merged);

          const saveResponse = await fetch("/api/progress", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ progress: merged }),
          });
          if (!saveResponse.ok) throw new Error("Progress could not be merged");
          setSyncStatus("synced");
        } catch {
          setSyncStatus("error");
        }
      })();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress, hydrated]);

  async function syncAnswer(topicName: Topic, countryCode: string, correctAnswer: boolean) {
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topicName, countryCode, correct: correctAnswer }),
      });
      if (!response.ok) throw new Error("Answer could not be saved");
      const payload = (await response.json()) as { record?: CountryProgress | null };
      if (payload.record) {
        setProgress((current) => ({
          ...current,
          [topicName]: { ...current[topicName], [countryCode]: payload.record as CountryProgress },
        }));
      }
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
    }
  }

  const stats = useMemo(() => {
    const topicProgress = progress[topic];
    const mastered = countries.filter((country) => topicProgress[country.code]?.mastered).length;
    const attempts = Object.values(topicProgress).reduce((sum, item) => sum + item.attempts, 0);
    const correct = Object.values(topicProgress).reduce((sum, item) => sum + item.correct, 0);
    return { mastered, remaining: countries.length - mastered, attempts, accuracy: attempts ? Math.round((correct / attempts) * 100) : 0 };
  }, [progress, topic]);

  function chooseTopic(nextTopic: Topic) {
    setTopic(nextTopic);
    setQuiz(null);
    setView("learn");
  }

  function startQuiz() {
    const questions = buildQuiz(topic, quizLength, progress);
    setQuiz({ questions, index: 0, score: 0, selectedCode: null, complete: questions.length === 0 });
  }

  function answer(code: string) {
    if (!quiz || quiz.selectedCode) return;
    const question = quiz.questions[quiz.index];
    const isCorrect = code === question.country.code;

    setQuiz({ ...quiz, selectedCode: code, score: quiz.score + (isCorrect ? 1 : 0) });
    setProgress((current) => {
      const old = current[topic][question.country.code] ?? { attempts: 0, correct: 0, streak: 0, mastered: false };
      const streak = isCorrect ? old.streak + 1 : 0;
      return {
        ...current,
        [topic]: {
          ...current[topic],
          [question.country.code]: {
            attempts: old.attempts + 1,
            correct: old.correct + (isCorrect ? 1 : 0),
            streak,
            mastered: streak >= 3,
          },
        },
      };
    });
    void syncAnswer(topic, question.country.code, isCorrect);
  }

  function nextQuestion() {
    if (!quiz) return;
    const atEnd = quiz.index === quiz.questions.length - 1;
    setQuiz(atEnd ? { ...quiz, complete: true } : { ...quiz, index: quiz.index + 1, selectedCode: null });
  }

  async function resetTopic() {
    if (!window.confirm(`Reset all ${topic} progress on every device?`)) return;
    setSyncStatus("syncing");
    try {
      const response = await fetch(`/api/progress?topic=${topic}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Progress could not be reset");
      setProgress((current) => ({ ...current, [topic]: {} }));
      setQuiz(null);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
    }
  }

  if (quiz) {
    return (
      <main className="app-shell quiz-shell">
        <header className="topbar compact-topbar">
          <button className="brand-button" onClick={() => setQuiz(null)} aria-label="Return to dashboard">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span>Wayfinder</span>
          </button>
          {!quiz.complete && quiz.questions.length > 0 && (
            <div className="quiz-position" aria-label={`Question ${quiz.index + 1} of ${quiz.questions.length}`}>
              <span>{quiz.index + 1}</span> / {quiz.questions.length}
            </div>
          )}
          <button className="quiet-button" onClick={() => setQuiz(null)}>Exit quiz</button>
        </header>

        {quiz.complete ? (
          <QuizComplete
            topic={topic}
            score={quiz.score}
            total={quiz.questions.length}
            remaining={countries.length - Object.values(progress[topic]).filter((item) => item.mastered).length}
            onAgain={startQuiz}
            onHome={() => setQuiz(null)}
          />
        ) : (
          <QuestionCard
            topic={topic}
            quiz={quiz}
            onAnswer={answer}
            onNext={nextQuestion}
          />
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => setView("learn")} aria-label="Wayfinder home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Wayfinder</span>
        </button>
        <nav className="main-nav" aria-label="Primary navigation">
          <button className={view === "learn" ? "active" : ""} onClick={() => setView("learn")}>Learn</button>
          <button className={view === "countries" ? "active" : ""} onClick={() => setView("countries")}>All countries</button>
        </nav>
        <div className={`device-note ${syncStatus}`} role="status">
          <span aria-hidden="true">●</span>
          {syncStatus === "synced" ? "Saved to your account" : syncStatus === "syncing" ? "Syncing progress…" : syncStatus === "local" ? "Saved on this device" : "Account sync paused"}
        </div>
      </header>

      {view === "countries" ? (
        <CountryLibrary search={search} onSearch={setSearch} progress={progress} topic={topic} />
      ) : (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">A little geography, every day</p>
              <h1>Know the world<br /><em>at a glance.</em></h1>
            </div>
            <p className="hero-copy">Build lasting recall with quick, adaptive quizzes. The things you know make room for the things you don’t.</p>
          </section>

          <section className="study-grid" aria-label="Quiz setup">
            <div className="topic-panel">
              <div className="section-heading">
                <span>01</span>
                <div><h2>Choose your study set</h2><p>Progress is kept separately for each set.</p></div>
              </div>
              <div className="topic-cards">
                <button className={`topic-card flag-card ${topic === "flags" ? "selected" : ""}`} onClick={() => chooseTopic("flags")}>
                  <span className="selection-dot" aria-hidden="true" />
                  <span className="card-label">Flags</span>
                  <span className="flag-stack" aria-hidden="true">
                    <b><FlagImage code="JP" /></b><b><FlagImage code="BR" /></b><b><FlagImage code="KE" /></b>
                  </span>
                  <strong>See it.<br />Name it.</strong>
                  <small>Country ↔ Flag</small>
                </button>
                <button className={`topic-card capital-card ${topic === "capitals" ? "selected" : ""}`} onClick={() => chooseTopic("capitals")}>
                  <span className="selection-dot" aria-hidden="true" />
                  <span className="card-label">Capitals</span>
                  <span className="city-lines" aria-hidden="true"><i>OSLO</i><i>NAIROBI</i><i>TOKYO</i></span>
                  <strong>Place the<br />capital.</strong>
                  <small>Country ↔ Capital</small>
                </button>
              </div>
            </div>

            <aside className="session-panel">
              <div className="section-heading">
                <span>02</span>
                <div><h2>Set your pace</h2><p>How many questions today?</p></div>
              </div>
              <div className="length-picker" role="group" aria-label="Quiz length">
                {[20, 30, 40, 50].map((length) => (
                  <button key={length} className={quizLength === length ? "active" : ""} onClick={() => setQuizLength(length)}>{length}</button>
                ))}
              </div>
              <div className="session-summary">
                <div><span>Today’s set</span><strong>{Math.min(quizLength, stats.remaining)}</strong><small>questions</small></div>
                <div><span>Still learning</span><strong>{stats.remaining}</strong><small>countries</small></div>
              </div>
              <button className="start-button" onClick={startQuiz} disabled={stats.remaining === 0 || syncStatus === "syncing"}>
                <span>{syncStatus === "syncing" ? "Syncing progress…" : stats.remaining === 0 ? "Set mastered" : `Start ${topic === "flags" ? "flag" : "capital"} quiz`}</span>
                <b aria-hidden="true">↗</b>
              </button>
              <p className="adaptive-note"><span aria-hidden="true">✦</span> Questions alternate direction and retire after a 3-answer streak.</p>
            </aside>
          </section>

          <section className="progress-strip">
            <div className="progress-title"><span>03</span><div><h2>Your {topic} progress</h2><p>{stats.attempts ? `${stats.accuracy}% accuracy across ${plural(stats.attempts, "answer")}` : "Your first answer starts the story."}</p></div></div>
            <div className="mastery-meter">
              <div className="meter-label"><span>Mastered</span><strong>{stats.mastered} <small>/ {countries.length}</small></strong></div>
              <div className="meter-track"><span style={{ width: `${(stats.mastered / countries.length) * 100}%` }} /></div>
            </div>
            <button className="text-button" onClick={() => setView("countries")}>View country library <span>→</span></button>
            {stats.attempts > 0 && <button className="reset-button" onClick={() => void resetTopic()}>Reset {topic}</button>}
          </section>
        </>
      )}
      <footer><span>Made for curious minds.</span><a href="/licenses/flag-icons-MIT.txt">Flags by flag-icons · MIT</a><span>{countries.length} countries · Flags & capitals</span></footer>
    </main>
  );
}

function QuestionCard({ topic, quiz, onAnswer, onNext }: { topic: Topic; quiz: QuizState; onAnswer: (code: string) => void; onNext: () => void }) {
  const question = quiz.questions[quiz.index];
  const answered = quiz.selectedCode !== null;
  const isCorrect = quiz.selectedCode === question.country.code;
  const countryFirst = question.direction === "country-to-answer";
  const prompt = topic === "flags"
    ? countryFirst ? `Which flag belongs to ${question.country.name}?` : "Which country uses this flag?"
    : countryFirst ? `What is the capital of ${question.country.name}?` : `Which country has ${question.country.capital} as its capital?`;

  return (
    <section className="question-wrap">
      <div className="question-progress"><span style={{ width: `${((quiz.index + (answered ? 1 : 0)) / quiz.questions.length) * 100}%` }} /></div>
      <div className="question-kicker"><span>{topic === "flags" ? "Flag study" : "Capital study"}</span><i /> <span>{countryFirst ? "Country → answer" : "Answer → country"}</span></div>
      {!countryFirst && topic === "flags" && <div className="question-flag"><FlagImage code={question.country.code} label="Flag to identify" /></div>}
      <h1>{prompt}</h1>
      <p className="question-hint">Choose the best answer.</p>
      <div className={`answer-grid ${topic === "flags" && countryFirst ? "flag-options" : ""}`}>
        {question.options.map((option, index) => {
          const selected = quiz.selectedCode === option.code;
          const correctOption = answered && option.code === question.country.code;
          const wrongOption = answered && selected && !correctOption;
          return (
            <button
              key={option.code}
              className={`${selected ? "selected" : ""} ${correctOption ? "correct" : ""} ${wrongOption ? "wrong" : ""}`}
              onClick={() => onAnswer(option.code)}
              disabled={answered}
            >
              <span className="answer-key">{String.fromCharCode(65 + index)}</span>
              {topic === "flags" && countryFirst ? (
                <FlagImage code={option.code} label={`Flag option ${index + 1}`} className="answer-flag" />
              ) : (
                <span className="answer-text">{countryFirst ? option.capital : option.name}</span>
              )}
              {correctOption && <span className="answer-mark">✓</span>}
              {wrongOption && <span className="answer-mark">×</span>}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`feedback ${isCorrect ? "success" : "error"}`} role="status">
          <div><strong>{isCorrect ? "That’s right." : "Not quite."}</strong><span><FlagImage code={question.country.code} /> {question.country.name} · {question.country.capital}</span></div>
          <button onClick={onNext}>{quiz.index === quiz.questions.length - 1 ? "See results" : "Next question"} <span>→</span></button>
        </div>
      )}
    </section>
  );
}

function QuizComplete({ topic, score, total, remaining, onAgain, onHome }: { topic: Topic; score: number; total: number; remaining: number; onAgain: () => void; onHome: () => void }) {
  const percent = total ? Math.round((score / total) * 100) : 100;
  return (
    <section className="complete-card">
      <div className="complete-burst" aria-hidden="true">✦</div>
      <p className="eyebrow">Session complete</p>
      <h1>{total ? (percent >= 80 ? "Nicely navigated." : "Every answer counts.") : "You’ve mastered this set."}</h1>
      <p>{total ? `You scored ${score} out of ${total} in your ${topic} session.` : `There are no ${topic} left in your learning queue.`}</p>
      <div className="score-ring"><strong>{percent}%</strong><span>accuracy</span></div>
      <div className="complete-stats"><div><strong>{score}</strong><span>correct</span></div><div><strong>{remaining}</strong><span>still learning</span></div></div>
      <div className="complete-actions"><button className="start-button" onClick={onAgain} disabled={remaining === 0}>Study another set <b>↗</b></button><button className="quiet-button" onClick={onHome}>Back to dashboard</button></div>
    </section>
  );
}

function CountryLibrary({ search, onSearch, progress, topic }: { search: string; onSearch: (value: string) => void; progress: Progress; topic: Topic }) {
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? countries.filter((country) => [country.name, country.capital, country.region].some((value) => value.toLocaleLowerCase().includes(query))) : countries;
  }, [search]);

  return (
    <section className="library">
      <div className="library-heading"><div><p className="eyebrow">The whole world</p><h1>Country library</h1><p>Browse every flag and capital in the study set.</p></div><label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search country, capital, or region" /></label></div>
      <div className="library-meta"><span>{filtered.length} of {countries.length} countries</span><span>Showing mastery for <b>{topic}</b></span></div>
      <div className="country-grid">
        {filtered.map((country) => {
          const record = progress[topic][country.code];
          return <article className="country-row" key={country.code}><FlagImage code={country.code} label={`Flag of ${country.name}`} className="library-flag" /><div><strong>{country.name}</strong><span>{country.region}</span></div><p>{country.capital}</p><span className={`status-pill ${record?.mastered ? "mastered" : record?.attempts ? "learning" : "new"}`}>{record?.mastered ? "Mastered" : record?.attempts ? `${record.streak}/3 streak` : "New"}</span></article>;
        })}
      </div>
      {filtered.length === 0 && <div className="empty-state">No countries match “{search}”.</div>}
    </section>
  );
}
