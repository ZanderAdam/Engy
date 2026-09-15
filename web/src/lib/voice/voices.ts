interface TtsVoice {
  id: string;
  name: string;
  description: string;
  model: string;
  speakerId: number;
}

export const DEFAULT_VOICE_ID = 'amy';

function single(id: string, name: string, description: string, model: string): TtsVoice {
  return { id, name, description, model, speakerId: 0 };
}

function semaine(id: string, name: string, description: string, speakerId: number): TtsVoice {
  return { id, name, description, model: 'en_GB-semaine-medium', speakerId };
}

export const TTS_VOICES: readonly TtsVoice[] = [
  single('amy', 'Amy', 'US, female', 'en_US-amy-low'),
  single('lessac', 'Lessac', 'US, female', 'en_US-lessac-medium'),
  single('kristin', 'Kristin', 'US, female', 'en_US-kristin-medium'),
  single('hfc-female', 'HFC', 'US, female', 'en_US-hfc_female-medium'),
  single('ryan', 'Ryan', 'US, male', 'en_US-ryan-medium'),
  single('joe', 'Joe', 'US, male', 'en_US-joe-medium'),
  single('john', 'John', 'US, male', 'en_US-john-medium'),
  single('norman', 'Norman', 'US, male', 'en_US-norman-medium'),
  single('hfc-male', 'HFC', 'US, male', 'en_US-hfc_male-medium'),
  single('alan', 'Alan', 'UK, male', 'en_GB-alan-medium'),
  single('northern', 'Northern', 'UK, male', 'en_GB-northern_english_male-medium'),
  semaine('obadiah', 'Obadiah', 'UK, male', 2),
  semaine('spike', 'Spike', 'UK, male', 1),
  single('alba', 'Alba', 'UK (Scottish), female', 'en_GB-alba-medium'),
  single('cori', 'Cori', 'UK, female', 'en_GB-cori-medium'),
  single('jenny', 'Jenny', 'UK, female', 'en_GB-jenny_dioco-medium'),
  semaine('prudence', 'Prudence', 'UK, female', 0),
  semaine('poppy', 'Poppy', 'UK, female', 3),
];

/** Unknown ids fall back to the default, so a stale browser preference or a
 * crafted request can never name a model outside this list. */
export function findVoice(id: string | null | undefined): TtsVoice {
  return TTS_VOICES.find((voice) => voice.id === id) ?? TTS_VOICES[0];
}
