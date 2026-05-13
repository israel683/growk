"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getActiveSystem } from "@/lib/system";

const STARTERS = [
  "מה מצב הצמחים עכשיו?",
  "מה החלטת בשעה האחרונה ולמה?",
  "ראיתי שהעלים קצת חיוורים — מה לעשות?",
  "האם כדאי להחליף מים השבוע?",
];

export default function ChatPage() {
  const [activeSystem, setActiveSystemState] = useState<string>("default");
  useEffect(() => {
    setActiveSystemState(getActiveSystem());
  }, []);

  const { messages, sendMessage, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ system: getActiveSystem() }),
    }),
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  function handleSubmit(text?: string) {
    const value = (text ?? input).trim();
    if (!value || status !== "ready") return;
    sendMessage({ text: value });
    setInput("");
  }

  const isEmpty = messages.length === 0;
  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <main className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-4 py-6 min-h-0">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pb-4 space-y-5 scroll-smooth"
      >
        {isEmpty && (
          <div className="text-center pt-16 pb-8">
            <h1 className="text-2xl font-semibold mb-2">
              שלום ישראל 👋
            </h1>
            <p className="text-zinc-500 text-sm leading-relaxed max-w-md mx-auto">
              אני המחקלאי שמטפל לך בהידרופוניקה.
              דבר איתי על הצמחים, שאל למה ביצעתי משהו, או בקש המלצה.
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-2 max-w-lg mx-auto">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSubmit(s)}
                  className="text-right text-sm p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <Spinner /> חושב...
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm p-3 rounded-lg flex items-start justify-between gap-3">
            <div className="break-words">
              <strong>שגיאה:</strong> {error.message}
            </div>
            <button
              onClick={() => regenerate()}
              className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/60 hover:bg-red-200 dark:hover:bg-red-900"
            >
              נסה שוב
            </button>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="border-t border-zinc-200 dark:border-zinc-800 pt-3 flex gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          rows={1}
          placeholder="כתוב הודעה..."
          disabled={isStreaming}
          className="flex-1 resize-none bg-zinc-100 dark:bg-zinc-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
          style={{ minHeight: 40, maxHeight: 160 }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed"
        >
          שלח
        </button>
      </form>
    </main>
  );
}

type UIMessageType = ReturnType<typeof useChat>["messages"][number];

function MessageBubble({ message }: { message: UIMessageType }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] ${
          isUser
            ? "bg-emerald-600 text-white rounded-2xl rounded-bl-md px-4 py-2"
            : "text-zinc-900 dark:text-zinc-100 leading-relaxed"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            if (isUser) {
              return (
                <p key={i} className="whitespace-pre-wrap text-sm">
                  {part.text}
                </p>
              );
            }
            return (
              <div key={i} className="text-sm prose-chat">
                <ReactMarkdown>{part.text}</ReactMarkdown>
              </div>
            );
          }
          if (part.type === "reasoning") {
            return (
              <details
                key={i}
                className="text-xs text-zinc-500 mt-2 mb-1"
              >
                <summary className="cursor-pointer">תהליך מחשבה</summary>
                <p className="mt-1 leading-relaxed" dir="ltr">
                  {("text" in part && (part as { text?: string }).text) || ""}
                </p>
              </details>
            );
          }
          if (typeof part.type === "string" && part.type.startsWith("tool-")) {
            return <ToolPart key={i} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ToolPart({ part }: { part: { type: string } & Record<string, unknown> }) {
  const toolName = part.type.replace(/^tool-/, "");
  const state = (part as { state?: string }).state;
  const inputData = (part as { input?: unknown }).input;
  const output = (part as { output?: unknown }).output;

  const labels: Record<string, string> = {
    getCurrentState: "📡 בודק מצב נוכחי",
    getRecentReadings: "📈 שולף היסטוריית חיישן",
    getRecentDecisions: "📋 בודק החלטות אחרונות",
    getPendingTasks: "✅ בודק משימות פתוחות",
    proposeAction: "💧 מציע פעולה",
    requestObservation: "📷 מבקש תצפית",
  };
  const label = labels[toolName] || `⚙️ ${toolName}`;

  return (
    <details className="my-2 text-xs bg-zinc-100 dark:bg-zinc-900 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-3 py-2 flex items-center gap-2 select-none">
        <span>{label}</span>
        {state === "input-streaming" || state === "input-available" ? (
          <Spinner />
        ) : null}
        {state === "output-error" && (
          <span className="text-red-500">שגיאה</span>
        )}
      </summary>
      <div className="px-3 pb-2 space-y-2 text-[11px]" dir="ltr">
        {inputData ? (
          <pre className="bg-white dark:bg-zinc-950 rounded p-2 overflow-x-auto">
            {JSON.stringify(inputData, null, 2)}
          </pre>
        ) : null}
        {output !== undefined ? (
          <pre className="bg-white dark:bg-zinc-950 rounded p-2 overflow-x-auto max-h-64">
            {JSON.stringify(output, null, 2)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border-2 border-zinc-300 dark:border-zinc-700 border-t-emerald-500 rounded-full animate-spin" />
  );
}
