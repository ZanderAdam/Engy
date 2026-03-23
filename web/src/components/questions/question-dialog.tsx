'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface QuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
}

interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface QuestionRow {
  id: number;
  taskId: number | null;
  sessionId: string;
  documentPath: string | null;
  question: string;
  header: string;
  options: QuestionOption[] | null;
  multiSelect: boolean | null;
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export function QuestionDialog({ open, onOpenChange, taskId }: QuestionDialogProps) {
  const { data: questions } = trpc.question.list.useQuery(
    { taskId, unanswered: true },
    { enabled: open },
  );
  const utils = trpc.useUtils();
  const submitAnswers = trpc.question.submitAnswers.useMutation({
    onSuccess: () => {
      utils.question.list.invalidate();
      utils.question.unansweredCount.invalidate();
      utils.question.unansweredByTask.invalidate();
      utils.task.get.invalidate();
      utils.task.list.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const [answers, setAnswers] = useState<Record<number, string>>({});

  const questionList = (questions ?? []) as QuestionRow[];

  const allAnswered =
    questionList.length > 0 && questionList.every((q) => !!answers[q.id]?.trim());

  function handleSubmit() {
    if (!allAnswered) return;
    submitAnswers.mutate({
      answers: questionList.map((q) => ({
        questionId: q.id,
        answer: answers[q.id],
      })),
    });
  }

  function setAnswer(questionId: number, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  if (questionList.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Questions</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-xs text-muted-foreground">No unanswered questions.</p>
        </DialogContent>
      </Dialog>
    );
  }

  const defaultTab = questionList[0].header;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[60vw] max-w-4xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Questions</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab}>
          <TabsList variant="line">
            {questionList.map((q) => (
              <TabsTrigger key={q.id} value={q.header}>
                {q.header}
                {!answers[q.id]?.trim() && (
                  <span className="ml-1 size-1.5 rounded-full bg-amber-400" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {questionList.map((q) => (
            <TabsContent key={q.id} value={q.header}>
              <QuestionContent
                question={q}
                answer={answers[q.id] ?? ''}
                onAnswer={(value) => setAnswer(q.id, value)}
              />
            </TabsContent>
          ))}
        </Tabs>

        <DialogFooter>
          <Button
            size="sm"
            disabled={!allAnswered || submitAnswers.isPending}
            onClick={handleSubmit}
          >
            {submitAnswers.isPending ? 'Submitting...' : 'Submit All'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuestionContent({
  question,
  answer,
  onAnswer,
}: {
  question: QuestionRow;
  answer: string;
  onAnswer: (value: string) => void;
}) {
  const options = question.options ?? [];
  const isMultiSelect = question.multiSelect ?? false;
  const [otherText, setOtherText] = useState('');
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

  function handleSingleSelect(label: string) {
    onAnswer(label);
    const opt = options.find((o) => o.label === label);
    setSelectedPreview(opt?.preview ?? null);
  }

  function handleMultiToggle(label: string, checked: boolean) {
    const current = answer ? answer.split(', ') : [];
    const next = checked ? [...current, label] : current.filter((v) => v !== label);
    onAnswer(next.join(', '));
    if (checked) {
      const opt = options.find((o) => o.label === label);
      setSelectedPreview(opt?.preview ?? null);
    }
  }

  function handleOther(text: string) {
    setOtherText(text);
    onAnswer(text);
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-sm">{question.question}</p>

      {options.length > 0 && !isMultiSelect && (
        <RadioGroup value={answer} onValueChange={handleSingleSelect}>
          {options.map((opt) => (
            <div key={opt.label} className="flex items-start gap-2">
              <RadioGroupItem value={opt.label} id={`q${question.id}-${opt.label}`} />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`q${question.id}-${opt.label}`} className="text-xs font-medium">
                  {opt.label}
                </Label>
                <span className="text-xs text-muted-foreground">{opt.description}</span>
              </div>
            </div>
          ))}
        </RadioGroup>
      )}

      {options.length > 0 && isMultiSelect && (
        <div className="flex flex-col gap-3">
          {options.map((opt) => {
            const selected = answer.split(', ').includes(opt.label);
            return (
              <div key={opt.label} className="flex items-start gap-2">
                <Checkbox
                  id={`q${question.id}-${opt.label}`}
                  checked={selected}
                  onCheckedChange={(checked) => handleMultiToggle(opt.label, !!checked)}
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`q${question.id}-${opt.label}`} className="text-xs font-medium">
                    {opt.label}
                  </Label>
                  <span className="text-xs text-muted-foreground">{opt.description}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedPreview && (
        <div className="rounded border border-border bg-muted/50 p-3">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Preview
          </p>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">{selectedPreview}</pre>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Other</Label>
        <Input
          placeholder="Type a custom answer..."
          value={otherText}
          onChange={(e) => handleOther(e.target.value)}
          className="text-xs"
        />
      </div>
    </div>
  );
}
