'use client';

import { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface QuestionCardProps {
  question: {
    id: number;
    header: string;
    question: string;
    options: QuestionOption[] | null;
    multiSelect: boolean | null;
  };
  answer: string;
  onAnswer: (value: string) => void;
  showHeader?: boolean;
}

export function QuestionCard({ question, answer, onAnswer, showHeader = true }: QuestionCardProps) {
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

  const idPrefix = `q${question.id}`;

  return (
    <div className="rounded border border-border p-3">
      {showHeader && (
        <Badge variant="outline" className="mb-2 text-[10px]">
          {question.header}
        </Badge>
      )}
      <p className="mb-3 text-sm">{question.question}</p>

      {options.length > 0 && !isMultiSelect && (
        <RadioGroup value={answer} onValueChange={handleSingleSelect} className="mb-3">
          {options.map((opt) => (
            <div key={opt.label} className="flex items-start gap-2">
              <RadioGroupItem value={opt.label} id={`${idPrefix}-${opt.label}`} />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${idPrefix}-${opt.label}`} className="text-xs font-medium">
                  {opt.label}
                </Label>
                <span className="text-xs text-muted-foreground">{opt.description}</span>
              </div>
            </div>
          ))}
        </RadioGroup>
      )}

      {options.length > 0 && isMultiSelect && (
        <div className="mb-3 flex flex-col gap-3">
          {options.map((opt) => {
            const selected = answer.split(', ').includes(opt.label);
            return (
              <div key={opt.label} className="flex items-start gap-2">
                <Checkbox
                  id={`${idPrefix}-${opt.label}`}
                  checked={selected}
                  onCheckedChange={(checked) => handleMultiToggle(opt.label, !!checked)}
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`${idPrefix}-${opt.label}`} className="text-xs font-medium">
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
        <div className="mb-3 rounded border border-border bg-muted/50 p-3">
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
