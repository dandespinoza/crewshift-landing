'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Send } from 'lucide-react';

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
}

const MOCK_MESSAGES: Message[] = [
  {
    id: '1',
    role: 'assistant',
    content:
      'Hi! I\'m your CrewShift AI Copilot. I can help you manage schedules, generate invoices, and automate workflows. What do you need today?',
    timestamp: '9:00 AM',
  },
  {
    id: '2',
    role: 'user',
    content: 'Can you show me who\'s available this Saturday?',
    timestamp: '9:01 AM',
  },
  {
    id: '3',
    role: 'assistant',
    content:
      'On Saturday you have 4 crew members available: Alex R., Jordan M., Casey T., and Sam L. Alex and Jordan are fully open, while Casey and Sam have afternoon availability only. Want me to auto-assign them to your open jobs?',
    timestamp: '9:01 AM',
  },
];

interface CopilotPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CopilotPanel({ isOpen, onClose }: CopilotPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>(MOCK_MESSAGES);

  function handleSend() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const newMessage: Message = {
      id: String(Date.now()),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="copilot-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/20"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.aside
            key="copilot-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="
              fixed inset-y-0 right-0 z-50
              flex flex-col
              w-full sm:w-[420px]
              bg-surface-bg0
              shadow-3
              rounded-l-xl
              overflow-hidden
            "
          >
            {/* Header */}
            <header className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-accent-500 flex items-center justify-center">
                  <span className="text-xs text-white font-semibold">AI</span>
                </div>
                <h2 className="text-base font-semibold text-text-primary">AI Copilot</h2>
                <span className="inline-flex items-center gap-1 text-xs text-success-text font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-success-solid" />
                  Online
                </span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close Copilot"
                className="h-8 w-8 flex items-center justify-center rounded-full text-text-tertiary hover:bg-surface-bg2 hover:text-text-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* Message list */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex flex-col gap-1 ${message.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`
                      max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed
                      ${
                        message.role === 'user'
                          ? 'bg-accent-500 text-white rounded-br-sm'
                          : 'bg-surface-bg1 text-text-primary rounded-bl-sm border border-border-subtle'
                      }
                    `}
                  >
                    {message.content}
                  </div>
                  <span className="text-xs text-text-tertiary px-1">{message.timestamp}</span>
                </div>
              ))}
            </div>

            {/* Input area */}
            <div className="px-4 py-3 border-t border-border">
              <div className="flex items-center gap-2 bg-surface-bg1 border border-border rounded-xl px-3 py-2 focus-within:border-accent-500 transition-colors">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask your copilot..."
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  aria-label="Send message"
                  className="h-7 w-7 flex items-center justify-center rounded-lg bg-accent-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-600 transition-colors flex-shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-2 text-xs text-center text-text-tertiary">
                AI responses may be inaccurate. Always verify critical decisions.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
