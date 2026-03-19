"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  User,
  Send,
  Search,
  AlertTriangle,
  FileText,
  ExternalLink,
  Copy,
  Check,
  Download,
  Shield,
  ShieldCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
  Play,
  Eye,
  Sparkles,
  MessageSquare,
  X,
  RefreshCw,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type MessageType =
  | "text"
  | "compliance_alert"
  | "action_suggestion"
  | "report_summary";

type MessageRole = "user" | "assistant";

interface Citation {
  title: string;
  source: string;
  url: string;
}

interface ActionButton {
  label: string;
  icon: "screening" | "report" | "details";
  action: string;
}

interface ChatMessage {
  id: string;
  role: MessageRole;
  type: MessageType;
  content: string;
  timestamp: number;
  citations?: Citation[];
  actions?: ActionButton[];
  alertSeverity?: "info" | "warning" | "critical";
  reportMetrics?: { label: string; value: string }[];
}

interface ComplianceCopilotProps {
  onAction?: (action: string, context?: Record<string, unknown>) => void;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CONVERSATION_STARTERS = [
  {
    label: "Run KYC screening",
    prompt: "Run a KYC screening on the latest onboarded identity",
  },
  {
    label: "Compliance status",
    prompt: "What is our current compliance status across all jurisdictions?",
  },
  {
    label: "Regulatory updates",
    prompt: "Show me recent regulatory updates that affect our operations",
  },
  {
    label: "Generate report",
    prompt: "Generate a compliance report for Q1 2026",
  },
  {
    label: "Risk assessment",
    prompt: "Perform a risk assessment on pending credential requests",
  },
  {
    label: "Sanctions check",
    prompt: "Run sanctions screening against the latest OFAC list",
  },
];

const ACTION_ICONS: Record<string, typeof Shield> = {
  screening: Play,
  report: FileText,
  details: Eye,
};

const ALERT_STYLES: Record<
  string,
  { border: string; bg: string; icon: string }
> = {
  info: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    icon: "text-blue-400",
  },
  warning: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    icon: "text-amber-400",
  },
  critical: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    icon: "text-red-400",
  },
};

// ============================================================================
// Helpers
// ============================================================================

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// Sub-components
// ============================================================================

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-brand-500/10 flex items-center justify-center flex-shrink-0">
        <Bot className="w-4 h-4 text-brand-500" />
      </div>
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-brand-500/50"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}

function CitationLink({ citation }: { citation: Citation }) {
  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400 transition-colors bg-brand-500/5 rounded px-2 py-0.5"
    >
      <ExternalLink className="w-3 h-3" />
      {citation.title}
    </a>
  );
}

function MessageBubble({
  message,
  onAction,
  onCopy,
}: {
  message: ChatMessage;
  onAction?: (action: string) => void;
  onCopy: (content: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const alertStyle = message.alertSeverity
    ? ALERT_STYLES[message.alertSeverity]
    : null;

  return (
    <motion.div
      className={`flex gap-3 px-4 py-2 ${isUser ? "flex-row-reverse" : ""}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? "bg-[var(--surface-tertiary)]" : "bg-brand-500/10"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-[var(--text-secondary)]" />
        ) : (
          <Bot className="w-4 h-4 text-brand-500" />
        )}
      </div>

      {/* Content */}
      <div
        className={`flex-1 max-w-[85%] space-y-2 ${isUser ? "items-end" : ""}`}
      >
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-brand-500 text-white ml-auto rounded-tr-sm"
              : alertStyle
                ? `${alertStyle.bg} border ${alertStyle.border} rounded-tl-sm`
                : "bg-[var(--surface-secondary)] text-[var(--text-primary)] rounded-tl-sm"
          }`}
        >
          {/* Alert header */}
          {message.type === "compliance_alert" && message.alertSeverity && (
            <div
              className={`flex items-center gap-2 mb-2 font-medium ${alertStyle!.icon}`}
            >
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">
                {message.alertSeverity} Alert
              </span>
            </div>
          )}

          {/* Report summary header */}
          {message.type === "report_summary" && (
            <div className="flex items-center gap-2 mb-2 text-brand-500 font-medium">
              <FileText className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">
                Report Summary
              </span>
            </div>
          )}

          <p className={isUser ? "text-white" : "text-[var(--text-primary)]"}>
            {message.content}
          </p>

          {/* Report metrics */}
          {message.reportMetrics && message.reportMetrics.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {message.reportMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="bg-[var(--surface-primary)] rounded-lg px-3 py-2"
                >
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                    {metric.label}
                  </p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Citations */}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {message.citations.map((citation, idx) => (
              <CitationLink key={idx} citation={citation} />
            ))}
          </div>
        )}

        {/* Action buttons */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {message.actions.map((action) => {
              const ActionIcon = ACTION_ICONS[action.icon];
              return (
                <button
                  key={action.action}
                  onClick={() => onAction?.(action.action)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/10 text-brand-500 hover:bg-brand-500/20 transition-colors"
                >
                  <ActionIcon className="w-3 h-3" />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Meta row */}
        {!isUser && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {formatTime(message.timestamp)}
            </span>
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-[var(--surface-secondary)] transition-colors"
              aria-label="Copy response"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />
              )}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function ComplianceCopilot({
  onAction,
  className = "",
}: ComplianceCopilotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, searchQuery]);

  const simulateResponse = useCallback((userMessage: string) => {
    setIsTyping(true);

    const timeout = setTimeout(
      () => {
        const responseTypes: ChatMessage[] = [
          {
            id: generateId(),
            role: "assistant",
            type: "compliance_alert",
            content:
              "I detected a potential compliance gap in the EU jurisdiction. The eIDAS 2.0 regulation requires updated credential schemas for cross-border identity verification effective March 2026.",
            timestamp: Date.now(),
            alertSeverity: "warning",
            citations: [
              {
                title: "eIDAS 2.0 Regulation",
                source: "EU Official Journal",
                url: "https://eur-lex.europa.eu/eli/reg/2024/1183/oj",
              },
            ],
            actions: [
              {
                label: "Run Screening",
                icon: "screening",
                action: "run_screening",
              },
              {
                label: "View Details",
                icon: "details",
                action: "view_details",
              },
            ],
          },
          {
            id: generateId(),
            role: "assistant",
            type: "report_summary",
            content:
              "Here is the compliance report summary. All critical metrics are within acceptable thresholds, with minor gaps identified in APAC jurisdictions.",
            timestamp: Date.now(),
            reportMetrics: [
              { label: "Overall Score", value: "94.2%" },
              { label: "Jurisdictions", value: "23 / 28" },
              { label: "Open Issues", value: "7" },
              { label: "Critical Gaps", value: "0" },
            ],
            actions: [
              {
                label: "Generate Full Report",
                icon: "report",
                action: "generate_report",
              },
            ],
          },
          {
            id: generateId(),
            role: "assistant",
            type: "action_suggestion",
            content:
              "Based on your query, I recommend running a comprehensive sanctions screening against the latest OFAC, EU, and UN consolidated lists. The last screening was completed 48 hours ago.",
            timestamp: Date.now(),
            actions: [
              {
                label: "Run Screening",
                icon: "screening",
                action: "run_sanctions_screening",
              },
              {
                label: "View Last Report",
                icon: "report",
                action: "view_last_report",
              },
              {
                label: "View Details",
                icon: "details",
                action: "view_screening_details",
              },
            ],
            citations: [
              {
                title: "OFAC SDN List",
                source: "US Treasury",
                url: "https://sanctionssearch.ofac.treas.gov/",
              },
            ],
          },
          {
            id: generateId(),
            role: "assistant",
            type: "text",
            content: userMessage.includes("status")
              ? "Your compliance posture is strong. 23 out of 28 target jurisdictions are fully compliant. 4 jurisdictions require updated KYC credential schemas, and 1 jurisdiction (Singapore) has a pending MAS regulatory review."
              : "I have analyzed the request. All identity credentials are within their validity window and the ZK proof circuits are up to date. No immediate action is required.",
            timestamp: Date.now(),
          },
        ];

        const response =
          responseTypes[Math.floor(Math.random() * responseTypes.length)];
        setMessages((prev) => [...prev, response]);
        setIsTyping(false);
      },
      1500 + Math.random() * 1000,
    );
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isTyping) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      type: "text",
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    simulateResponse(trimmed);
  }, [input, isTyping, simulateResponse]);

  const handleStarterClick = useCallback(
    (prompt: string) => {
      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        type: "text",
        content: prompt,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      simulateResponse(prompt);
    },
    [simulateResponse],
  );

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // Clipboard unavailable
    }
  }, []);

  const handleExport = useCallback(() => {
    const text = messages
      .map((m) => `[${formatTime(m.timestamp)}] ${m.role}: ${m.content}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-copilot-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  const handleActionClick = useCallback(
    (action: string) => {
      onAction?.(action);
    },
    [onAction],
  );

  return (
    <div
      className={`flex flex-col h-[600px] rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-primary)] overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)] bg-[var(--surface-elevated)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-brand-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Compliance Copilot
            </h3>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              AI-powered regulatory assistant
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
            aria-label="Search messages"
          >
            <Search className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
            aria-label="Toggle history"
          >
            <MessageSquare className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleExport}
              className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
              aria-label="Export conversation"
            >
              <Download className="w-4 h-4 text-[var(--text-tertiary)]" />
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            className="px-4 py-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)]"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversation..."
                className="w-full pl-9 pr-8 py-2 rounded-lg bg-[var(--surface-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-brand-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-2">
        {filteredMessages.length === 0 && !isTyping ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mb-4">
              <ShieldCheck className="w-8 h-8 text-brand-500" />
            </div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
              Compliance Copilot
            </h4>
            <p className="text-xs text-[var(--text-secondary)] mb-6 max-w-xs">
              Ask me about compliance status, regulatory updates, risk
              assessments, or run automated screening workflows.
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
              {CONVERSATION_STARTERS.map((starter) => (
                <button
                  key={starter.label}
                  onClick={() => handleStarterClick(starter.prompt)}
                  className="text-left px-3 py-2.5 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors text-xs text-[var(--text-secondary)]"
                >
                  {starter.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {filteredMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onAction={handleActionClick}
                onCopy={handleCopy}
              />
            ))}
            {isTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Suggested prompts (when conversation is active) */}
      {messages.length > 0 && messages.length < 6 && !isTyping && (
        <div className="px-4 py-2 border-t border-[var(--border-primary)]">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {CONVERSATION_STARTERS.slice(0, 3).map((starter) => (
              <button
                key={starter.label}
                onClick={() => handleStarterClick(starter.prompt)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full border border-[var(--border-primary)] text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] transition-colors"
              >
                {starter.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--surface-elevated)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask about compliance, regulations, or risk..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-brand-500 transition-colors"
            disabled={isTyping}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="p-2.5 rounded-xl bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Send message"
          >
            {isTyping ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
