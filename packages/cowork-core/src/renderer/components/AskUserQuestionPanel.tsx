import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight, HelpCircle, Send, X } from 'lucide-react';
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '../types';

interface AskUserQuestionPanelProps {
  request: AskUserQuestionRequest;
  onRespond: (toolUseId: string, answers: AskUserQuestionAnswer[]) => void;
}

function createEmptyAnswers(count: number): AskUserQuestionAnswer[] {
  return Array.from({ length: count }, () => ({ selectedLabels: [] }));
}

export function AskUserQuestionPanel({ request, onRespond }: AskUserQuestionPanelProps) {
  const { t } = useTranslation();
  const { toolUseId, questions } = request;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AskUserQuestionAnswer[]>(() =>
    createEmptyAnswers(questions.length)
  );

  useEffect(() => {
    setIndex(0);
    setAnswers(createEmptyAnswers(questions.length));
  }, [questions.length, toolUseId]);

  const question = questions[index];
  if (!question) {
    return null;
  }

  const answer = answers[index] ?? { selectedLabels: [] };
  const isLast = index === questions.length - 1;
  const isSingleImmediate = questions.length === 1 && !question.multiSelect;

  const submit = (finalAnswers: AskUserQuestionAnswer[]) => {
    onRespond(toolUseId, finalAnswers);
  };

  const moveNextOrSubmit = (finalAnswers: AskUserQuestionAnswer[]) => {
    if (isSingleImmediate || isLast) {
      submit(finalAnswers);
      return;
    }
    setAnswers(finalAnswers);
    setIndex((current) => Math.min(current + 1, questions.length - 1));
  };

  const replaceAnswer = (nextAnswer: AskUserQuestionAnswer) => {
    const nextAnswers = answers.map((item, itemIndex) =>
      itemIndex === index ? nextAnswer : item
    );
    setAnswers(nextAnswers);
    return nextAnswers;
  };

  const selectOption = (label: string) => {
    if (question.multiSelect) {
      const selected = new Set(answer.selectedLabels);
      if (selected.has(label)) {
        selected.delete(label);
      } else {
        selected.add(label);
      }
      replaceAnswer({
        selectedLabels: Array.from(selected),
        customText: answer.customText,
      });
      return;
    }

    const nextAnswers = replaceAnswer({ selectedLabels: [label] });
    moveNextOrSubmit(nextAnswers);
  };

  const updateCustomText = (customText: string) => {
    replaceAnswer({
      selectedLabels: answer.selectedLabels,
      customText,
      skipped: false,
    });
  };

  const submitCurrent = () => {
    moveNextOrSubmit(answers);
  };

  const skipCurrent = () => {
    const nextAnswers = replaceAnswer({ selectedLabels: [], skipped: true });
    moveNextOrSubmit(nextAnswers);
  };

  const skipAll = () => {
    submit(questions.map(() => ({ selectedLabels: [], skipped: true })));
  };

  const hasAnswer =
    answer.skipped ||
    answer.selectedLabels.length > 0 ||
    Boolean(answer.customText && answer.customText.trim());

  return (
    <div className="mb-3 overflow-hidden rounded-lg border-2 border-accent/30 bg-gradient-to-br from-accent/5 to-transparent">
      <div className="px-4 py-3 bg-accent/10 border-b border-accent/20 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
          <HelpCircle className="w-4 h-4 text-accent" />
        </div>
        <span className="font-medium text-sm text-text-primary">
          {t('askUserQuestion.title')}
        </span>

        {questions.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-text-muted">
              {t('askUserQuestion.pager', { current: index + 1, total: questions.length })}
            </span>
            <button
              type="button"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-40"
              title={t('askUserQuestion.prev')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIndex((current) => Math.min(questions.length - 1, current + 1))}
              disabled={isLast}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-40"
              title={t('askUserQuestion.next')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={skipAll}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-error/10"
              title={t('askUserQuestion.skipAll')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="space-y-2">
          {question.header && (
            <span className="inline-block px-2 py-0.5 bg-accent/10 text-accent text-xs font-semibold rounded uppercase">
              {question.header}
            </span>
          )}
          <p className="text-text-primary font-medium text-sm">{question.question}</p>
        </div>

        {question.options && question.options.length > 0 && (
          <div className="space-y-1.5">
            {question.options.map((option, optionIndex) => {
              const selected = answer.selectedLabels.includes(option.label);
              return (
                <button
                  type="button"
                  key={`${option.label}-${optionIndex}`}
                  onClick={() => selectOption(option.label)}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    selected
                      ? 'border-accent bg-accent/10'
                      : 'border-border-subtle bg-surface-muted hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-xs font-semibold ${
                        selected
                          ? 'bg-accent text-background'
                          : 'bg-border-subtle text-text-secondary'
                      }`}
                    >
                      {question.multiSelect && selected ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        optionIndex + 1
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary">{option.label}</span>
                      {option.description && (
                        <p className="text-xs text-text-muted mt-0.5">{option.description}</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <textarea
          value={answer.customText ?? ''}
          onChange={(event) => updateCustomText(event.target.value)}
          placeholder={t('askUserQuestion.orDirect')}
          rows={2}
          className="w-full resize-none px-3 py-2 rounded-lg border border-border bg-background text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent/30"
        />

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={skipCurrent}
            className="px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            {t('askUserQuestion.skip')}
          </button>

          <button
            type="button"
            onClick={submitCurrent}
            disabled={!hasAnswer}
            className="px-3 py-2 rounded-lg bg-accent text-background text-sm font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {isLast ? t('askUserQuestion.send') : t('askUserQuestion.next')}
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
