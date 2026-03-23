'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QuestionCard } from '@/components/questions/question-card';
import { toast } from 'sonner';

interface QuestionRow {
  id: number;
  header: string;
  question: string;
  context: string | null;
  options: { label: string; description: string; preview?: string }[] | null;
  multiSelect: boolean | null;
}

interface QuestionAnswerPanelProps {
  questions: QuestionRow[];
  onSubmitted?: () => void;
}

export function QuestionAnswerPanel({ questions, onSubmitted }: QuestionAnswerPanelProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const utils = trpc.useUtils();

  const submitAnswers = trpc.question.submitAnswers.useMutation({
    onSuccess: () => {
      setAnswers({});
      utils.question.list.invalidate();
      utils.question.unansweredCount.invalidate();
      utils.question.unansweredByTask.invalidate();
      utils.task.get.invalidate();
      utils.task.list.invalidate();
      onSubmitted?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const allAnswered =
    questions.length > 0 && questions.every((q) => !!answers[q.id]?.trim());

  function handleSubmit() {
    if (!allAnswered) return;
    submitAnswers.mutate({
      answers: questions.map((q) => ({
        questionId: q.id,
        answer: answers[q.id],
      })),
    });
  }

  if (questions.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">No unanswered questions.</p>;
  }

  const defaultTab = questions[0].id.toString();
  const context = questions[0].context;

  return (
    <div className="flex flex-col gap-4">
      {context && (
        <p className="text-xs text-muted-foreground">{context}</p>
      )}
      <Tabs defaultValue={defaultTab}>
        <TabsList variant="line">
          {questions.map((q) => (
            <TabsTrigger key={q.id} value={q.id.toString()}>
              {q.header}
              {!answers[q.id]?.trim() && (
                <span className="ml-1 size-1.5 rounded-full bg-amber-400" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {questions.map((q) => (
          <TabsContent key={q.id} value={q.id.toString()}>
            <QuestionCard
              question={q}
              answer={answers[q.id] ?? ''}
              onAnswer={(value) => setAnswers((prev) => ({ ...prev, [q.id]: value }))}
              showHeader={false}
            />
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!allAnswered || submitAnswers.isPending}
          onClick={handleSubmit}
        >
          {submitAnswers.isPending ? 'Submitting...' : 'Submit All'}
        </Button>
      </div>
    </div>
  );
}
